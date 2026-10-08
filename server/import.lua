-- /bankimport <source> [confirm] [skip=type,type] [force]
-- Moves balances from another bank into LWK Bank. Without `confirm` it only shows what
-- it would import. Each source imports once (`force` to repeat).
--   renewed | qb | qbmanagement | okok   read from that bank's database tables, so they
--                                        work after the old bank is removed
--   fd | tgg | tgiann | wasabi | p       those banks' tables aren't documented, so the old
--                                        bank is asked for each job/gang balance through
--                                        its own export: it must still be running
-- Players' main bank money is framework money in every one of these banks, so it is
-- already in place; this moves society/job/gang, shared and extra accounts.

local function hasTable(name)
    return MySQL.scalar.await('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', { name }) > 0
end

local function list(raw)
    local ok, t = pcall(json.decode, raw or '[]')
    if not ok or type(t) ~= 'table' then return {} end
    local out = {}
    for k, v in pairs(t) do
        if type(k) == 'number' and type(v) == 'string' then out[#out + 1] = v
        elseif type(k) == 'string' and v == true then out[#out + 1] = k end -- { [cid] = true }
    end
    return out
end

-- Each source: rows of { type, kind = 'business'|'shared'|'personal', name, label, owner, balance, members }
local SOURCES = {
    renewed = function()
        if not hasTable('bank_accounts_new') then return nil end
        local out = {}
        for _, a in ipairs(MySQL.query.await('SELECT * FROM bank_accounts_new')) do
            if a.creator and a.creator ~= '' then
                out[#out + 1] = { type = 'shared', kind = 'shared', name = a.id, owner = a.creator, balance = a.amount, members = list(a.auth) }
            else
                out[#out + 1] = { type = 'society', kind = 'business', name = a.id, balance = a.amount }
            end
        end
        return out
    end,
    qb = function()
        if not hasTable('bank_accounts') then return nil end
        local out = {}
        for _, a in ipairs(MySQL.query.await('SELECT * FROM bank_accounts')) do
            local t = a.account_type
            if t == 'job' or t == 'gang' then
                out[#out + 1] = { type = t, kind = 'business', name = a.account_name, balance = a.account_balance }
            elseif a.citizenid then
                out[#out + 1] = { type = t, kind = t == 'shared' and 'shared' or 'personal', name = a.account_name, owner = a.citizenid,
                    balance = a.account_balance, members = list(a.users) }
            end
        end
        return out
    end,
    qbmanagement = function()
        if not hasTable('management_funds') then return nil end
        local out = {}
        for _, a in ipairs(MySQL.query.await('SELECT * FROM management_funds')) do
            out[#out + 1] = { type = a.type or 'boss', kind = 'business', name = a.job_name, balance = a.amount }
        end
        return out
    end,
    okok = function()
        if not hasTable('okokbanking_societies') then return nil end
        local out = {}
        for _, s in ipairs(MySQL.query.await('SELECT * FROM okokbanking_societies')) do
            out[#out + 1] = { type = 'society', kind = 'business', name = (tostring(s.society):gsub('^society_', '')), label = s.society_name, balance = s.value }
        end
        if hasTable('okokbanking_accounts') then
            for _, a in ipairs(MySQL.query.await('SELECT * FROM okokbanking_accounts')) do
                if a.account_holder then
                    out[#out + 1] = { type = a.account_type or 'account', kind = 'personal', name = a.account_name or 'Account', owner = a.account_holder,
                        balance = a.balance }
                end
            end
        end
        return out
    end,
}

--- A source that asks the old bank itself: one balance per framework job and gang.
local function fromExports(resource, read)
    return function()
        if not Compat.realRunning(resource) then return nil, resource end
        local out = {}
        for name, label in pairs(Bridge.groups()) do
            local ok, balance = pcall(read, name)
            balance = ok and tonumber(balance) or 0
            if balance > 0 then
                out[#out + 1] = { type = 'society', kind = 'business', name = name, label = label, balance = math.floor(balance) }
            end
        end
        return out
    end
end

SOURCES.fd = fromExports('fd_banking', function(name) return exports['fd_banking']:GetAccount(name) end)
SOURCES.tgg = fromExports('tgg-banking', function(name) return exports['tgg-banking']:GetSocietyAccountMoney(name) end)
SOURCES.tgiann = fromExports('tgiann-bank', function(name) return exports['tgiann-bank']:GetJobAccountBalance(name) end)
SOURCES.wasabi = fromExports('wasabi_banking', function(name) return exports['wasabi_banking']:GetAccountBalance(name, 'society') end)
SOURCES.p = fromExports('p_banking', function(name) return exports['p_banking']:getAccountMoney(name) end)

local function apply(e)
    local balance = math.max(0, math.floor(tonumber(e.balance) or 0))
    -- Empty job/gang accounts are recreated on first use anyway; don't clutter with them.
    if e.kind == 'business' and balance == 0 then return 'empty' end
    if e.kind == 'business' then
        local row = Compat.business(e.name, true)
        if not row then return false end
        if e.label then MySQL.update.await('UPDATE lwk_bank_accounts SET name = ? WHERE id = ?', { e.label, row.id }) end
        if balance > 0 then
            if not Accounts.credit(row, balance) then return false end
            Accounts.log(row.id, 'deposit', balance, L('import_tx'))
        end
        return true
    end
    if e.kind == 'shared' then
        local row = Compat.createShared(e.owner, e.name, balance, e.members)
        if row and balance > 0 then Accounts.log(row.id, 'deposit', balance, L('import_tx')) end
        return row ~= nil
    end
    local id = MySQL.insert.await("INSERT INTO lwk_bank_accounts (iban, type, name, owner, balance, created_at) VALUES (?, 'personal', ?, ?, ?, ?)",
        { Accounts.newIban(), Logic.text(e.name, 1, 48) or 'Account', e.owner, balance, Logic.now() })
    if balance > 0 then Accounts.log(id, 'deposit', balance, L('import_tx')) end
    return true
end

local function reply(src, lines)
    local text = table.concat(lines, '\n')
    if src == 0 then print(text) else TriggerClientEvent('lwk_bank:adminInfo', src, text) end
end

-- Every DB call yields, so two imports started together could both pass the "already
-- imported" check and credit everything twice. One import at a time.
local running = false

CreateThread(function()
    MySQL.query.await([[CREATE TABLE IF NOT EXISTS `lwk_bank_imports` (
        `source` VARCHAR(32) NOT NULL, `imported_at` BIGINT NOT NULL, `summary` VARCHAR(255) NOT NULL, PRIMARY KEY (`source`))]])
end)

local run -- the import itself, below the command

lib.addCommand('bankimport', {
    help = L('cmd_import_help'),
    params = {
        { name = 'source', type = 'string', help = 'renewed | qb | qbmanagement | okok | fd | tgg | tgiann | wasabi | p' },
        { name = 'options', type = 'longString', optional = true, help = 'confirm, skip=type,type, force' },
    },
}, function(src, args)
    if src ~= 0 and not Bridge.isAdmin(src) then return Bridge.notify(src, L('err_no_permission'), 'error') end
    local name, opts = tostring(args.source):lower(), ' ' .. (args.options or '') .. ' '
    local read = SOURCES[name]
    if not read then return reply(src, { L('import_unknown') }) end
    local confirm, force = opts:find(' confirm ') ~= nil, opts:find(' force ') ~= nil
    local skip = {}
    for t in (opts:match('skip=(%S+)') or ''):gmatch('[^,]+') do skip[t] = true end

    if running then return reply(src, { L('import_busy') }) end
    running = true
    local okRun, err = pcall(function()
        local done = MySQL.single.await('SELECT * FROM lwk_bank_imports WHERE source = ?', { name })
        if done and not force then return reply(src, { L('import_already', name, done.summary) }) end
        local rows, mustRun = read()
        if not rows then return reply(src, { mustRun and L('import_not_running', mustRun) or L('import_no_tables', name) }) end
        run(src, name, rows, skip, confirm)
    end)
    running = false
    if not okRun then print(('^1[lwk_bank] bankimport failed: %s^0'):format(err)) end
end)

function run(src, name, rows, skip, confirm)

    -- Summary by type, so double counting (e.g. a type that is really the main account) is visible.
    local byType, order, total, count = {}, {}, 0, 0
    for _, e in ipairs(rows) do
        if not skip[e.type] then
            local t = byType[e.type]
            if not t then t = { n = 0, sum = 0 } byType[e.type] = t order[#order + 1] = e.type end
            t.n, t.sum = t.n + 1, t.sum + (tonumber(e.balance) or 0)
            total, count = total + (tonumber(e.balance) or 0), count + 1
        end
    end
    local lines = { L(confirm and 'import_doing' or 'import_preview', name) }
    for _, t in ipairs(order) do lines[#lines + 1] = ('- %s: %d accounts, $%s'):format(t, byType[t].n, byType[t].sum) end
    lines[#lines + 1] = L('import_total', count, total)
    if not confirm then
        lines[#lines + 1] = L('import_how', name)
        return reply(src, lines)
    end

    local ok, empty, failed = 0, 0, 0
    for _, e in ipairs(rows) do
        if not skip[e.type] then
            local success, result = pcall(apply, e)
            if result == 'empty' then
                empty = empty + 1
            elseif success and result then
                ok = ok + 1
            else
                failed = failed + 1
                print(('^3[lwk_bank] import skipped %s (%s): %s^0'):format(tostring(e.name), e.type, success and 'not created' or result))
            end
        end
    end
    local summary = ('%d accounts, $%s'):format(ok, total)
    MySQL.query.await('REPLACE INTO lwk_bank_imports (source, imported_at, summary) VALUES (?, ?, ?)', { name, Logic.now(), summary })
    lines[#lines + 1] = L('import_result', ok, empty, failed)
    reply(src, lines)
    Logs.event(src ~= 0 and src or nil, 'admin', 'Bank import', ('%s: %s'):format(name, summary))
end
