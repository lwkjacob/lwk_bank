-- Pure helpers: no natives, no database.

Logic = {}

function Logic.now()
    return os.time() * 1000
end

--- Whole, positive, sane amount or nil.
--- A yes/no column. oxmysql returns TINYINT(1) as true/false, other drivers as 1/0.
function Logic.flag(v)
    return v == true or v == 1
end

function Logic.amount(v, max)
    v = tonumber(v)
    if not v or v ~= v or v <= 0 or v % 1 ~= 0 or v > (max or 1e12) then return nil end
    return math.floor(v)
end

--- Trimmed string within length limits, or nil.
function Logic.text(v, minLen, maxLen)
    if type(v) ~= 'string' then return nil end
    v = v:gsub('^%s+', ''):gsub('%s+$', '')
    if #v < (minLen or 1) or #v > (maxLen or 48) then return nil end
    return v
end

function Logic.iban(v)
    if type(v) ~= 'string' then return nil end
    v = v:upper()
    return v:match('^[A-Z0-9]+$') and #v >= 4 and #v <= 12 and v or nil
end

function Logic.randomIban(prefix)
    return ('%s%06d'):format(prefix, math.random(0, 999999))
end

function Logic.randomDigits(n)
    local s = ''
    for _ = 1, n do s = s .. math.random(0, 9) end
    return s
end

local INCOMING = { deposit = true, transfer_in = true, paycheck = true, interest = true, loan = true }
function Logic.isIncoming(txType)
    return INCOMING[txType] == true
end

--- Closing balance for each of the last `days` days (oldest first), walked back
--- from today's balance using the transactions (newest first is fine, any order).
function Logic.history(balance, transactions, days, nowMs)
    days = days or 7
    local dayMs = 86400000
    local startOfToday = nowMs - (nowMs % dayMs)
    local net = {}
    for _, tx in ipairs(transactions) do
        if (tx.pot or 'checking') == 'checking' then
            local back = math.floor((startOfToday - (tx.date - (tx.date % dayMs))) / dayMs)
            if back >= 0 and back < days then
                net[back] = (net[back] or 0) + (Logic.isIncoming(tx.type) and tx.amount or -tx.amount)
            end
        end
    end
    local out, running = {}, balance
    for back = 0, days - 1 do
        out[days - back] = running
        running = running - (net[back] or 0)
    end
    return out
end

--- Simple interest over the term, equal daily instalments (mirrors web/src/logic.ts).
function Logic.quoteLoan(amount, planRate, termDays, adjust)
    local rate = math.max(0, planRate + adjust)
    local interest = math.floor(amount * rate / 100 + 0.5)
    local total = amount + interest
    return { rate = rate, interest = interest, total = total, daily = math.ceil(total / math.max(termDays, 1)) }
end

function Logic.creditBand(score, bands)
    local pick = bands[1]
    for _, b in ipairs(bands) do
        if score >= b.min then pick = b end
    end
    return pick
end

--- "name 2", "name 3"... cut to fit maxLen, for when `name` is already taken.
function Logic.suffixed(name, n, maxLen)
    if n <= 1 then return name:sub(1, maxLen) end
    local suffix = ' ' .. n
    return name:sub(1, maxLen - #suffix) .. suffix
end

-- Config editor --------------------------------------------------------------------

--- Checks a value from the in-game editor against its config.lua default (the template):
--- same types, same keys (extra ones dropped, missing ones defaulted), arrays shaped like
--- the template's first item. Returns the clean value, or nil + the path of the bad field.
function Logic.sanitize(value, template, path)
    path = path or ''
    local tt = type(template)
    if tt == 'number' then
        value = tonumber(value)
        if not value or value ~= value or math.abs(value) == math.huge then return nil, path end
        return value
    elseif tt == 'string' then
        if type(value) ~= 'string' or #value > 256 then return nil, path end
        return value
    elseif tt == 'boolean' then
        if type(value) ~= 'boolean' then return nil, path end
        return value
    elseif tt == 'table' and type(value) == 'table' then
        local out = {}
        if template[1] ~= nil then
            if #value > 200 then return nil, path end
            for i = 1, #value do
                local v, bad = Logic.sanitize(value[i], template[1], ('%s[%d]'):format(path, i))
                if v == nil then return nil, bad end
                out[i] = v
            end
            return out
        end
        for k, t in pairs(template) do
            local key = path == '' and k or (path .. '.' .. k)
            if value[k] == nil then
                out[k] = t
            else
                local v, bad = Logic.sanitize(value[k], t, key)
                if v == nil then return nil, bad end
                out[k] = v
            end
        end
        return out
    end
    return nil, path
end

local function isArray(t) return type(t) == 'table' and (t[1] ~= nil or next(t) == nil) end

local function same(a, b)
    if type(a) ~= type(b) then return false end
    -- Positions pass through 32-bit floats (vector4), so 149.05 can come back as 149.0500030517578.
    if type(a) == 'number' then return math.abs(a - b) < 1e-3 end
    if type(a) ~= 'table' then return a == b end
    for k, v in pairs(a) do if not same(v, b[k]) then return false end end
    for k in pairs(b) do if a[k] == nil then return false end end
    return true
end

--- What `value` changes compared to `base`: objects recurse, lists and values count
--- as a whole. Returns nil when nothing differs. Saved instead of the full config, so
--- config.lua still controls everything an admin never touched in the editor.
function Logic.diff(value, base)
    if type(value) == 'table' and type(base) == 'table' and not isArray(value) and not isArray(base) then
        local out
        for k, v in pairs(value) do
            local d = Logic.diff(v, base[k])
            if d ~= nil then
                out = out or {}
                out[k] = d
            end
        end
        return out
    end
    if same(value, base) then return nil end
    return value
end

--- `base` with `over` laid on top (the reverse of diff).
function Logic.merge(base, over)
    if over == nil then return base end
    -- An empty {} from JSON over an object means "no changes", not "replace with nothing".
    if type(base) ~= 'table' or type(over) ~= 'table' or isArray(base) or over[1] ~= nil then return over end
    local out = {}
    for k, v in pairs(base) do out[k] = v end
    for k, v in pairs(over) do out[k] = Logic.merge(base[k], v) end
    return out
end

local function nonNegative(t, path, skip)
    for k, v in pairs(t) do
        local key = type(k) == 'number' and ('%s[%d]'):format(path, k) or (path .. '.' .. k)
        if type(v) == 'number' and v < 0 and not skip[k] then return key end
        if type(v) == 'table' then
            local bad = nonNegative(v, key, skip)
            if bad then return bad end
        end
    end
end

local function hex(v) return v:match('^#%x%x%x%x%x%x$') or v:match('^#%x%x%x$') end

--- A card picture: none, a file in images/ or an https link. It ends up in a CSS url(),
--- so nothing that could close one.
local function cardImage(v)
    return v == '' or v:match('^[%w_%-]+%.%a+$') or v:match('^https://[^%s"\'()\\]+$')
end

--- Rules a type check can't express. Returns the path of the first bad field, or nil.
function Logic.checkConfig(c)
    if not c.bankName:find('%S') or #c.bankName > 32 then return 'bankName' end
    if not hex(c.accent) then return 'accent' end
    if not c.currency:match('^%u%u%u$') then return 'currency' end
    if not c.accounts.ibanPrefix:match('^%u%u?%u?%u?$') then return 'accounts.ibanPrefix' end
    if c.sound.volume > 1 then return 'sound.volume' end
    for _, key in ipairs({ 'cards', 'accounts', 'savingsRates', 'loans', 'interaction', 'blips', 'logs', 'sound' }) do
        local bad = nonNegative(c[key], key, { adjust = true })
        if bad then return bad end
    end
    if c.cards.maxCards < 1 or c.cards.pinAttempts < 1 then return 'cards' end
    -- A config.lua from before card looks has neither field: the UI uses its defaults.
    for name, t in pairs(c.cards.tiers) do
        if t.cardColor and not hex(t.cardColor) then return ('cards.tiers.%s.cardColor'):format(name) end
        if t.image and not cardImage(t.image) then return ('cards.tiers.%s.image'):format(name) end
    end
    if #c.loans.plans == 0 then return 'loans.plans' end
    local ids = {}
    for i, p in ipairs(c.loans.plans) do
        if not p.id:match('^[%w_-]+$') or ids[p.id] or not p.name:find('%S') or p.max < p.min then
            return ('loans.plans[%d]'):format(i)
        end
        ids[p.id] = true
    end
    if #c.loans.terms == 0 then return 'loans.terms' end
    for i, d in ipairs(c.loans.terms) do
        if d < 1 or d % 1 ~= 0 then return ('loans.terms[%d]'):format(i) end
    end
    if #c.loans.bands == 0 then return 'loans.bands' end
    for i, b in ipairs(c.banks) do
        if not b.label:find('%S') then return ('banks[%d]'):format(i) end
    end
end

return Logic
