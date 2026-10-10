-- Staff commands. Allowed: ACE 'lwk_bank.admin' (add_ace group.admin lwk_bank.admin allow),
-- or on ESX the groups in config.admin.esxGroups. Every use is logged.

local function allowed(src)
    if src == 0 then return true end -- server console
    if Bridge.isAdmin(src) then return true end
    Bridge.notify(src, L('err_no_permission'), 'error')
    return false
end

--- A server id of an online player, or a raw citizenid/identifier for offline lookups.
-- (Command params are left untyped: ox_lib's 'string' type rejects anything numeric,
-- which would refuse server ids, numeric character ids and a card's last 4 digits.)
local function resolve(arg)
    arg = arg and tostring(arg) or ''
    if arg == '' then return nil, nil end
    -- A bare number is a server id when that player is online. 'char:<id>' forces an
    -- identifier lookup, for frameworks whose character ids are numbers (ND_Core).
    local forced = arg:match('^char:(.+)$')
    local id = not forced and tonumber(arg)
    if id and GetPlayerName(id) then return Bridge.identifier(id), id end
    local identifier = forced or arg
    return identifier, Bridge.sourceOf(identifier)
end

local function reply(src, text)
    if src == 0 then print(text) else Bridge.notify(src, text, 'inform') end
end

lib.addCommand('bankadmin', {
    help = L('cmd_lookup_help'),
    params = { { name = 'target', help = L('cmd_target_help') } },
}, function(src, args)
    if not allowed(src) then return end
    local identifier = resolve(args.target)
    if not identifier then return reply(src, L('err_player_offline')) end
    local lines = { ('**%s** · `%s`'):format(Bridge.offlineName(identifier), identifier),
        L('admin_score', Loans and Loans.score(identifier) or '-'), '' }
    for _, a in ipairs(MySQL.query.await('SELECT * FROM lwk_bank_accounts WHERE owner = ? ORDER BY is_default DESC', { identifier })) do
        local balance = Logic.flag(a.is_default) and L('admin_framework_bank') or ('$' .. a.balance)
        lines[#lines + 1] = ('- %s (%s) · `%s` · %s · %s $%s'):format(a.name, a.type, a.iban, balance, L('admin_savings'), a.savings)
    end
    for _, c in ipairs(MySQL.query.await('SELECT tier, last4, status FROM lwk_bank_cards WHERE owner = ?', { identifier })) do
        lines[#lines + 1] = ('- %s •••• %s · %s'):format(c.tier, c.last4, c.status)
    end
    for _, l in ipairs(MySQL.query.await('SELECT plan_id, remaining, status FROM lwk_bank_loans WHERE owner = ?', { identifier })) do
        lines[#lines + 1] = ('- %s loan · $%s left · %s'):format(l.plan_id, l.remaining, l.status)
    end
    local text = table.concat(lines, '\n')
    if src == 0 then print(text) else TriggerClientEvent('lwk_bank:adminInfo', src, text) end
    Logs.event(src ~= 0 and src or nil, 'admin', 'Bank lookup', identifier)
end)

local function cardOf(identifier, last4)
    return MySQL.single.await('SELECT * FROM lwk_bank_cards WHERE owner = ? AND last4 = ?', { identifier, tostring(last4) })
end

lib.addCommand('bankpin', {
    help = L('cmd_pin_help'),
    params = { { name = 'target', help = L('cmd_target_help') }, { name = 'last4', help = L('cmd_last4_help') } },
}, function(src, args)
    if not allowed(src) then return end
    local identifier, online = resolve(args.target)
    local card = identifier and cardOf(identifier, args.last4)
    if not card then return reply(src, L('err_card_missing')) end
    local pin = Logic.randomDigits(4)
    MySQL.update.await('UPDATE lwk_bank_cards SET pin_hash = ?, pin_fails = 0 WHERE id = ?', { GetPasswordHash(pin), card.id })
    if online then Bridge.notify(online, L('card_pin_notice', card.last4, pin), 'inform') end
    reply(src, online and L('admin_pin_sent') or L('admin_pin_offline', pin))
    Logs.event(src ~= 0 and src or nil, 'admin', 'PIN reset', ('%s •••• %s'):format(identifier, card.last4))
end)

lib.addCommand('bankunfreeze', {
    help = L('cmd_unfreeze_help'),
    params = { { name = 'target', help = L('cmd_target_help') }, { name = 'last4', help = L('cmd_last4_help') } },
}, function(src, args)
    if not allowed(src) then return end
    local identifier, online = resolve(args.target)
    local card = identifier and cardOf(identifier, args.last4)
    if not card then return reply(src, L('err_card_missing')) end
    MySQL.update.await("UPDATE lwk_bank_cards SET status = 'active', pin_fails = 0 WHERE id = ? AND status = 'blocked'", { card.id })
    if online then Bank.refresh(online) end
    reply(src, L('admin_done'))
    Logs.event(src ~= 0 and src or nil, 'admin', 'Card unfrozen', ('%s •••• %s'):format(identifier, card.last4))
end)

lib.addCommand('bankscore', {
    help = L('cmd_score_help'),
    params = { { name = 'target', help = L('cmd_target_help') }, { name = 'score', type = 'number', help = '300-850' } },
}, function(src, args)
    if not allowed(src) or not Loans then return end
    local identifier, online = resolve(args.target)
    if not identifier then return reply(src, L('err_player_offline')) end
    Loans.adjustScore(identifier, (tonumber(args.score) or 0) - Loans.score(identifier))
    if online then Bank.refresh(online) end
    reply(src, L('admin_done'))
    Logs.event(src ~= 0 and src or nil, 'admin', 'Credit score set', ('%s -> %s'):format(identifier, args.score))
end)
