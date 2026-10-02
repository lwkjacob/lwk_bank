-- CDECAD mode on a Qbox/QBCore/ESX server: LWK Bank data from before CDECAD is saved under
-- the player's character (citizenid/license), not their /setciv civilian. When they open
-- the bank they're offered a one-time move of all of it, plus the character's framework
-- bank money, to the civilian they're playing. Nothing moves without a yes.

local active = Bridge.framework == 'cdecad' and Bridge.base ~= 'none'
GlobalState.lwk_bank_cdecadMove = active

local declined, moving = {}, {} -- src -> civilian they said no for (this session) / move running

AddEventHandler('playerDropped', function()
    declined[source], moving[source] = nil, nil
end)

local function moved(from) return GetResourceKvpString('cdecad_moved:' .. from) ~= nil end

local function hasData(from)
    for _, sql in ipairs({
        "SELECT 1 FROM lwk_bank_accounts WHERE owner = ? AND type <> 'business' LIMIT 1",
        'SELECT 1 FROM lwk_bank_members WHERE identifier = ? LIMIT 1',
        'SELECT 1 FROM lwk_bank_contacts WHERE identifier = ? LIMIT 1',
        'SELECT 1 FROM lwk_bank_cards WHERE owner = ? LIMIT 1',
        'SELECT 1 FROM lwk_bank_loans WHERE owner = ? LIMIT 1',
    }) do
        if MySQL.scalar.await(sql, { from }) then return true end
    end
    return false
end

--- The character and civilian to move between, or nil when there's nothing to offer.
local function pair(src)
    if not active then return nil end
    local from, to = Bridge.characterIdentifier(src), Bridge.identifier(src)
    if not from or not to or from == to or moved(from) then return nil end
    return from, to
end

local function move(src, from, to)
    local queries = {}
    local function q(query, values) queries[#queries + 1] = { query = query, values = values } end

    -- Keep the character's main account (the IBAN people have saved) and fold the
    -- civilian's into it, if the civilian already has one.
    local old = MySQL.scalar.await('SELECT id FROM lwk_bank_accounts WHERE owner = ? AND is_default = 1', { from })
    local new = MySQL.scalar.await('SELECT id FROM lwk_bank_accounts WHERE owner = ? AND is_default = 1', { to })
    if old and new then
        for _, t in ipairs({ 'lwk_bank_cards', 'lwk_bank_loans', 'lwk_bank_goals', 'lwk_bank_interest', 'lwk_bank_transactions' }) do
            q(('UPDATE %s SET account_id = ? WHERE account_id = ?'):format(t), { old, new })
        end
        q('UPDATE lwk_bank_accounts a JOIN lwk_bank_accounts n ON n.id = ? SET a.savings = a.savings + n.savings WHERE a.id = ?', { new, old })
        q('DELETE FROM lwk_bank_accounts WHERE id = ?', { new })
    end
    q("UPDATE lwk_bank_accounts SET owner = ? WHERE owner = ? AND type <> 'business'", { to, from })
    q('UPDATE IGNORE lwk_bank_members SET identifier = ?, name = ? WHERE identifier = ?', { to, Bridge.name(src), from })
    q('DELETE FROM lwk_bank_members WHERE identifier = ?', { from })
    -- Being a member of an account you now own is redundant.
    q('DELETE m FROM lwk_bank_members m JOIN lwk_bank_accounts a ON a.id = m.account_id WHERE m.identifier = ? AND a.owner = ?', { to, to })
    q('DELETE c FROM lwk_bank_contacts c JOIN lwk_bank_contacts n ON n.identifier = ? AND n.iban = c.iban WHERE c.identifier = ?', { to, from })
    q('UPDATE lwk_bank_contacts SET identifier = ? WHERE identifier = ?', { to, from })
    q('UPDATE lwk_bank_cards SET owner = ? WHERE owner = ?', { to, from })
    q('UPDATE lwk_bank_loans SET owner = ? WHERE owner = ?', { to, from })
    local score = MySQL.scalar.await('SELECT score FROM lwk_bank_credit WHERE identifier = ?', { from })
    if score then
        q('INSERT INTO lwk_bank_credit (identifier, score) VALUES (?, ?) ON DUPLICATE KEY UPDATE score = VALUES(score)', { to, score })
        q('DELETE FROM lwk_bank_credit WHERE identifier = ?', { from })
    end
    q('UPDATE lwk_bank_bill_history SET identifier = ? WHERE identifier = ?', { to, from })
    if not MySQL.transaction.await(queries) then return false end

    -- The money last: if it fails, the accounts have already moved and a retry
    -- (offered again on the next open, because the money is still there) only moves it.
    local bank = Bridge.characterBank(src)
    if bank > 0 then
        if not Bridge.removeCharacterBank(src, bank, 'lwk_bank cdecad move') then return false end
        if not Bridge.addMoney(src, 'bank', bank, 'lwk_bank cdecad move') then
            Bridge.addCharacterBank(src, bank, 'lwk_bank cdecad move refund')
            return false
        end
        Accounts.log(Accounts.ensureDefault(to).id, 'deposit', bank, L('tx_cdecad_move'))
    end
    SetResourceKvp('cdecad_moved:' .. from, to)
    Logs.event(src, 'cdecad', 'Bank moved to CDECAD civilian', ('%s -> %s ($%d)'):format(from, to, bank))
    return true
end

--- What the client shows in the prompt: { name = civilian, bank = framework bank money }.
lib.callback.register('lwk_bank:cdecadOffer', function(src)
    local from, to = pair(src)
    if not from or declined[src] == to then return nil end
    local bank = Bridge.characterBank(src)
    if bank <= 0 and not hasData(from) then return nil end
    return { name = Bridge.name(src), bank = bank }
end)

lib.callback.register('lwk_bank:cdecadMove', function(src, accept)
    local from, to = pair(src)
    if not from or moving[src] then return false end
    if accept ~= true then
        declined[src] = to
        return false
    end
    moving[src] = true
    local ok, result = pcall(move, src, from, to)
    moving[src] = nil
    if not ok then
        print(('^1[lwk_bank] CDECAD move %s -> %s failed: %s^0'):format(from, to, result))
        return false
    end
    return result
end)
