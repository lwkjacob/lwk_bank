-- Framework bridge (server). Everything framework-specific lives here so the rest of
-- the resource only speaks: identifier, name, money (cash/bank), job, admin.
-- Detected once: qbx_core > qb-core > es_extended > CDECAD. Config.framework can force one.
--
-- CDECAD support (Config.framework = 'cdecad', or auto when CDECAD runs with no framework):
--   * the player is their active /setciv civilian, set by CDECAD; identifier is its SSN, name is its name
--   * the bank balance IS the civilian's CDECAD bank account, read and moved through
--     the CAD's /fivem/bank API, so the website, the phone app, cde-economy and this
--     bank all show one number
--   * cash, jobs, gangs and ESX admin groups still come from qbx_core / qb-core /
--     es_extended when one is running; with no framework, cash is a per-civilian
--     wallet kept in this resource's KVP store
-- It reads the same server.cfg convars as CDECAD and cde-economy, fresh on every call,
-- so a console `set` after start takes effect without a restart:
--   set CDE_CAD_API_URL "https://your-cdecad-instance.com/api"
--   set CDE_CAD_API_KEY "your-fivem-api-key"
--   set CDE_CAD_RESOURCE "CDECAD"     # only if you renamed the CDECAD folder
--###########################################################################--
-- CONVARS ARE NOT SET IN THIS FILE ONLY IN SERVER.CFG

Bridge = Bridge or {}

local function present(res) return GetResourceState(res) ~= 'missing' end

local function cadResource()
    local n = GetConvar('CDE_CAD_RESOURCE', 'CDECAD')
    return n ~= '' and n or 'CDECAD'
end

-- The game framework underneath, whatever handles the bank.
local base = (Config.framework ~= 'auto' and Config.framework ~= 'cdecad' and Config.framework)
    or (present('qbx_core') and 'qbox')
    or (present('qb-core') and 'qb')
    or (present('es_extended') and 'esx')
    or 'none'

local fw = Config.framework == 'cdecad' and 'cdecad'
    or Config.framework ~= 'auto' and Config.framework
    or (base == 'none' and present(cadResource()) and 'cdecad')
    or base
Bridge.framework = fw
Bridge.base = base -- the framework under CDECAD mode ('none' when standalone)

local cad = fw == 'cdecad'

local QB, ESX
local function core()
    if base == 'qb' and not QB then QB = exports['qb-core']:GetCoreObject() end
    if base == 'esx' and not ESX then ESX = exports.es_extended:getSharedObject() end
end

local function player(src)
    core()
    if base == 'qbox' then return exports.qbx_core:GetPlayer(src) end
    if base == 'qb' then return QB.Functions.GetPlayer(src) end
    if base == 'esx' then return ESX.GetPlayerFromId(src) end
end

-- 'cash' | 'bank' -> the framework's account name
local function moneyType(kind)
    if base == 'esx' then return kind == 'cash' and 'money' or 'bank' end
    return kind
end

-- CDECAD ----------------------------------------------------------------------------

-- Read fresh each call so a console `set CDE_CAD_API_KEY ...` after start works.
local function cadCreds()
    local url = GetConvar('CDE_CAD_API_URL', ''):gsub('/+$', '')
    if url ~= '' and not url:find('/api$') then url = url .. '/api' end
    return url, GetConvar('CDE_CAD_API_KEY', '')
end

local warnedCreds = false
local function cadConfigured()
    local url, key = cadCreds()
    if url ~= '' and key ~= '' then return true end
    if not warnedCreds then
        warnedCreds = true
        print('^1[lwk_bank] CDE_CAD_API_URL / CDE_CAD_API_KEY are not set in server.cfg - CDECAD bank balances cannot be read or moved.^0')
    end
    return false
end

-- SSNs come from the CAD, but they still go into a URL path: escape them.
local function seg(v)
    return (tostring(v or ''):gsub('[^%w%-%._~]', function(c) return ('%%%02X'):format(c:byte()) end))
end

-- Blocking HTTP call to the CAD. Every Bridge caller in lwk_bank runs inside a net event
-- or lib.callback handler, which can yield. Returns status, decoded body (or nil).
local function cadRequest(method, path, body)
    if not cadConfigured() then return 0, nil end
    if not coroutine.isyieldable() then
        print(('^1[lwk_bank] CDECAD %s %s was called outside a thread and was skipped.^0'):format(method, path))
        return 0, nil
    end
    local url, key = cadCreds()
    local p = promise.new()
    PerformHttpRequest(url .. path, function(status, text)
        local data
        if text and text ~= '' then
            local ok, decoded = pcall(json.decode, text)
            if ok then data = decoded end
        end
        p:resolve({ status, data })
    end, method, body and json.encode(body) or '', {
        ['Content-Type'] = 'application/json',
        ['Accept'] = 'application/json',
        ['x-api-key'] = key,
    })
    -- A stalled response must not hold the bank UI forever.
    SetTimeout(10000, function() if p.state == 0 then p:resolve({ 0, nil }) end end)
    local r = Citizen.Await(p)
    return r[1], r[2]
end

local function cadOk(status, data)
    return status >= 200 and status < 300 and type(data) == 'table' and data.success == true
end

local function civOf(src)
    local res = cadResource()
    local ok, civ = pcall(function() return exports[res]:GetActiveCivilian(src) end)
    if ok and type(civ) == 'table' then
        local id = civ.ssn or civ.id or civ._id
        if id ~= nil and tostring(id) ~= '' then return civ, tostring(id) end
    end
end

local names = {} -- civId -> display name, so lists of offline members skip the API

local function civName(civ, id)
    local n = (('%s %s'):format(civ.firstName or '', civ.lastName or ''):gsub('^%s+', ''):gsub('%s+$', ''))
    if n ~= '' then names[id] = n end
    return n ~= '' and n or id
end

-- The account list asks for every default account's balance on each open. Five seconds
-- keeps that under the CAD's per-key rate limit; every write here replaces the entry
-- with the balance the CAD returned, so this bank's own moves show at once.
local BALANCE_TTL = 5000
local balances = {} -- civId -> { value, at }

local function setBalance(id, value)
    value = tonumber(value)
    if value then balances[id] = { value = math.floor(value), at = GetGameTimer() } else balances[id] = nil end
end

local function cadBalance(id)
    local c = balances[id]
    if c and GetGameTimer() - c.at < BALANCE_TTL then return c.value end
    local status, data = cadRequest('GET', '/fivem/bank/account/' .. seg(id))
    if not cadOk(status, data) then return c and c.value or 0 end
    if data.civilianName then names[id] = data.civilianName end
    setBalance(id, data.balance)
    return balances[id] and balances[id].value or 0
end

local depositCounter = 0

local function cadDeposit(id, amount, reason)
    depositCounter = depositCounter + 1
    -- One key for the call and its retry: a deposit that landed but whose response was
    -- lost is replayed by the CAD, never applied twice.
    local body = {
        civilianId = id, amount = amount, description = reason or 'LWK Bank',
        idempotencyKey = ('lwk_bank:%s:%d:%d'):format(id, os.time(), depositCounter),
    }
    local status, data = cadRequest('POST', '/fivem/bank/deposit', body)
    if status == 0 or status == 429 or status >= 500 then
        status, data = cadRequest('POST', '/fivem/bank/deposit', body)
    end
    if not cadOk(status, data) then
        balances[id] = nil
        print(('^1[lwk_bank] CDECAD deposit of $%d to %s failed: %s^0'):format(amount, id, (type(data) == 'table' and data.msg) or ('HTTP ' .. status)))
        return false
    end
    setBalance(id, data.balance)
    return true
end

-- The CAD checks the balance and debits in one operation, and refuses frozen accounts.
local function cadWithdraw(id, amount, reason)
    local status, data = cadRequest('POST', '/fivem/bank/withdraw', {
        civilianId = id, amount = amount, description = reason or 'LWK Bank',
    })
    if not cadOk(status, data) then
        balances[id] = nil
        return false
    end
    setBalance(id, data.balance)
    return true
end

-- Cash for standalone CDECAD (no framework): one integer per civilian in this
-- resource's KVP. Read and write happen with no yield between them, so two events
-- can't both spend the same dollars.
local function kvpCash(id) return GetResourceKvpInt('cdecad_cash:' .. id) end
local function setKvpCash(id, v) SetResourceKvpInt('cdecad_cash:' .. id, v) end

-- No civilian means no bank to open; say why instead of leaving the prompt dead.
local nudged = {}
local function nudge(src)
    local now = GetGameTimer()
    if nudged[src] and now - nudged[src] < 10000 then return end
    nudged[src] = now
    Notify(src, L('err_setciv'), 'error')
end
AddEventHandler('playerDropped', function() nudged[source] = nil end)

-- Bridge --------------------------------------------------------------------------

function Bridge.ready(src)
    if cad then return civOf(src) ~= nil end
    return player(src) ~= nil
end

function Bridge.identifier(src)
    if cad then
        local civ, id = civOf(src)
        if not civ then nudge(src) return nil end
        civName(civ, id)
        return id
    end
    local p = player(src)
    if not p then return nil end
    if fw == 'esx' then return p.getIdentifier() end
    return p.PlayerData.citizenid
end

function Bridge.name(src)
    if cad then
        local civ, id = civOf(src)
        return civ and civName(civ, id) or GetPlayerName(src)
    end
    local p = player(src)
    if not p then return GetPlayerName(src) end
    if fw == 'esx' then return p.getName() end
    local c = p.PlayerData.charinfo or {}
    return (('%s %s'):format(c.firstname or '', c.lastname or ''):gsub('^%s+', ''):gsub('%s+$', ''))
end

function Bridge.getMoney(src, kind)
    if cad then
        local _, id = civOf(src)
        if kind == 'bank' then return id and cadBalance(id) or 0 end
        if base == 'none' then return id and kvpCash(id) or 0 end
    end
    local p = player(src)
    if not p then return 0 end
    if base == 'esx' then
        local acc = p.getAccount(moneyType(kind))
        return acc and acc.money or 0
    end
    return p.Functions.GetMoney(kind) or 0
end

function Bridge.addMoney(src, kind, amount, reason)
    if amount <= 0 then return false end
    if cad then
        local _, id = civOf(src)
        if kind == 'bank' then return id ~= nil and cadDeposit(id, amount, reason) end
        if base == 'none' then
            if not id then return false end
            setKvpCash(id, kvpCash(id) + amount)
            return true
        end
    end
    local p = player(src)
    if not p then return false end
    if base == 'esx' then
        p.addAccountMoney(moneyType(kind), amount, reason)
        return true
    end
    return p.Functions.AddMoney(kind, amount, reason) ~= false
end

-- Checks the balance itself: never trust a framework to refuse an overdraft.
-- (CDECAD's withdraw does that check atomically on the CAD side.)
function Bridge.removeMoney(src, kind, amount, reason)
    if amount <= 0 then return false end
    if cad then
        local _, id = civOf(src)
        if kind == 'bank' then return id ~= nil and cadWithdraw(id, amount, reason) end
        if base == 'none' then
            if not id or kvpCash(id) < amount then return false end
            setKvpCash(id, kvpCash(id) - amount)
            return true
        end
    end
    local p = player(src)
    if not p or Bridge.getMoney(src, kind) < amount then return false end
    if base == 'esx' then
        p.removeAccountMoney(moneyType(kind), amount, reason)
        return true
    end
    return p.Functions.RemoveMoney(kind, amount, reason) == true
end

-- CDECAD mode on top of a framework: the character behind the civilian. LWK Bank data from
-- before CDECAD is saved under this id, and its framework bank money is no longer shown;
-- server/cdecad.lua offers to move both to the civilian.
function Bridge.characterIdentifier(src)
    if not cad or base == 'none' then return nil end
    local p = player(src)
    if not p then return nil end
    if base == 'esx' then return p.getIdentifier() end
    return p.PlayerData.citizenid
end

function Bridge.characterBank(src)
    local p = cad and player(src)
    if not p then return 0 end
    if base == 'esx' then
        local acc = p.getAccount('bank')
        return acc and acc.money or 0
    end
    return p.Functions.GetMoney('bank') or 0
end

function Bridge.addCharacterBank(src, amount, reason)
    local p = cad and player(src)
    if not p or amount <= 0 then return false end
    if base == 'esx' then
        p.addAccountMoney('bank', amount, reason)
        return true
    end
    return p.Functions.AddMoney('bank', amount, reason) ~= false
end

function Bridge.removeCharacterBank(src, amount, reason)
    local p = cad and player(src)
    if not p or amount <= 0 or Bridge.characterBank(src) < amount then return false end
    if base == 'esx' then
        p.removeAccountMoney('bank', amount, reason)
        return true
    end
    return p.Functions.RemoveMoney('bank', amount, reason) == true
end

function Bridge.sourceOf(identifier)
    if cad then
        identifier = tostring(identifier)
        for _, s in ipairs(GetPlayers()) do
            local src = tonumber(s)
            local _, id = civOf(src)
            if id == identifier then return src end
        end
        return nil
    end
    core()
    if fw == 'qbox' then
        local p = exports.qbx_core:GetPlayerByCitizenId(identifier)
        return p and p.PlayerData.source
    end
    if fw == 'qb' then
        local p = QB.Functions.GetPlayerByCitizenId(identifier)
        return p and p.PlayerData.source
    end
    if fw == 'esx' then
        local p = ESX.GetPlayerFromIdentifier(identifier)
        return p and p.source
    end
end

-- Bank money for a player who isn't online: edit the stored JSON directly.
-- In CDECAD mode the account lives in the CAD, so online or not is the same call.
function Bridge.addBankOffline(identifier, amount)
    if cad then return amount > 0 and cadDeposit(tostring(identifier), amount, 'LWK Bank') end
    if fw == 'qb' or fw == 'qbox' then
        return MySQL.update.await(
            "UPDATE players SET money = JSON_SET(money, '$.bank', CAST(JSON_EXTRACT(money, '$.bank') AS SIGNED) + ?) WHERE citizenid = ?",
            { amount, identifier }) > 0
    end
    if fw == 'esx' then
        return MySQL.update.await(
            "UPDATE users SET accounts = JSON_SET(accounts, '$.bank', CAST(JSON_EXTRACT(accounts, '$.bank') AS SIGNED) + ?) WHERE identifier = ?",
            { amount, identifier }) > 0
    end
    return false
end

--- Offline debit, only if the stored balance covers it (atomic in the WHERE clause).
function Bridge.removeBankOffline(identifier, amount)
    if cad then return amount > 0 and cadWithdraw(tostring(identifier), amount, 'LWK Bank') end
    if fw == 'qb' or fw == 'qbox' then
        return MySQL.update.await(
            "UPDATE players SET money = JSON_SET(money, '$.bank', CAST(JSON_EXTRACT(money, '$.bank') AS SIGNED) - ?) WHERE citizenid = ? AND CAST(JSON_EXTRACT(money, '$.bank') AS SIGNED) >= ?",
            { amount, identifier, amount }) > 0
    end
    if fw == 'esx' then
        return MySQL.update.await(
            "UPDATE users SET accounts = JSON_SET(accounts, '$.bank', CAST(JSON_EXTRACT(accounts, '$.bank') AS SIGNED) - ?) WHERE identifier = ? AND CAST(JSON_EXTRACT(accounts, '$.bank') AS SIGNED) >= ?",
            { amount, identifier, amount }) > 0
    end
    return false
end

-- Display name for an identifier that may be offline (for member lists, receipts).
function Bridge.offlineName(identifier)
    if cad then
        identifier = tostring(identifier)
        if names[identifier] then return names[identifier] end
        cadBalance(identifier) -- the account lookup returns the civilian's name too
        return names[identifier] or identifier
    end
    if fw == 'qb' or fw == 'qbox' then
        local info = MySQL.scalar.await('SELECT charinfo FROM players WHERE citizenid = ?', { identifier })
        local c = info and json.decode(info)
        return c and ('%s %s'):format(c.firstname, c.lastname) or identifier
    end
    if fw == 'esx' then
        local row = MySQL.single.await('SELECT firstname, lastname FROM users WHERE identifier = ?', { identifier })
        return row and ('%s %s'):format(row.firstname, row.lastname) or identifier
    end
    return identifier
end

function Bridge.getJob(src)
    local p = player(src)
    if not p then return nil end
    if base == 'esx' then
        local j = p.getJob()
        return { name = j.name, label = j.label, grade = j.grade, isBoss = j.grade_name == 'boss' }
    end
    local j = p.PlayerData.job
    return { name = j.name, label = j.label, grade = j.grade and j.grade.level or 0, isBoss = j.isboss == true }
end

--- The player's gang (QBCore/Qbox only), or nil.
function Bridge.getGang(src)
    if base ~= 'qb' and base ~= 'qbox' then return nil end
    local p = player(src)
    local g = p and p.PlayerData.gang
    if not g or not g.name or g.name == 'none' then return nil end
    return { name = g.name, label = g.label, isBoss = g.isboss == true }
end

--- Label of a job or gang, or nil when the framework has no group by that name.
function Bridge.groupLabel(name)
    if type(name) ~= 'string' then return nil end
    core()
    local g
    if base == 'qbox' then
        g = exports.qbx_core:GetJob(name) or exports.qbx_core:GetGang(name)
    elseif base == 'qb' then
        g = QB.Shared.Jobs[name] or QB.Shared.Gangs[name]
    elseif base == 'esx' then
        g = ESX.GetJobs()[name]
    end
    return g and g.label
end

--- Every job and gang the framework knows: { [name] = label }.
function Bridge.groups()
    core()
    local out = {}
    local function take(groups)
        for name, g in pairs(groups or {}) do out[name] = type(g) == 'table' and g.label or name end
    end
    if base == 'qbox' then
        take(exports.qbx_core:GetJobs())
        take(exports.qbx_core:GetGangs())
    elseif base == 'qb' then
        take(QB.Shared.Jobs)
        take(QB.Shared.Gangs)
    elseif base == 'esx' then
        take(ESX.GetJobs())
    end
    return out
end

function Bridge.isAdmin(src)
    if IsPlayerAceAllowed(src, Cfg().admin.ace) then return true end
    local p = player(src)
    if base == 'esx' and p then
        local g = p.getGroup()
        for _, allowed in ipairs(Cfg().admin.esxGroups) do
            if g == allowed then return true end
        end
    end
    return false
end

function Bridge.notify(src, message, kind)
    Notify(src, message, kind)
end

if fw == 'none' then
    print('^1[lwk_bank] No supported framework found (qbx_core, qb-core, es_extended, CDECAD). The bank will not work.^0')
elseif cad then
    CreateThread(function()
        Wait(2000)
        if GetResourceState(cadResource()) ~= 'started' then
            print(('^1[lwk_bank] CDECAD mode, but resource "%s" is not started. Start it before lwk_bank, or set CDE_CAD_RESOURCE "<name>" in server.cfg if you renamed it.^0'):format(cadResource()))
        end
        if cadConfigured() then
            print(('^2[lwk_bank] CDECAD mode: bank balances live in the CAD (cash from %s).^0'):format(base == 'none' and 'KVP wallet' or base))
        end
    end)
end
