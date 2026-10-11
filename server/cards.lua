-- Bank cards: ordering, activation, limits, PINs, renewal, and the ATM's card check.
-- A card belongs to one player (owner) and draws on one account.

Cards = {}

local ok, fail = Bank.ok, Bank.fail
local DAY = 86400000

CreateThread(function()
    MySQL.query.await([[CREATE TABLE IF NOT EXISTS `lwk_bank_cards` (
        `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
        `account_id`  INT UNSIGNED NOT NULL,
        `owner`       VARCHAR(64)  NOT NULL,
        `holder`      VARCHAR(64)  NOT NULL,
        `tier`        VARCHAR(16)  NOT NULL,
        `last4`       CHAR(4)      NOT NULL,
        `pin_hash`    VARCHAR(255) NOT NULL,
        `pin_fails`   TINYINT      NOT NULL DEFAULT 0,
        `status`      VARCHAR(16)  NOT NULL DEFAULT 'inactive',
        `daily_limit` BIGINT       NOT NULL,
        `spent_today` BIGINT       NOT NULL DEFAULT 0,
        `spent_day`   INT          NOT NULL DEFAULT 0,
        `auto_renew`  TINYINT(1)   NOT NULL DEFAULT 0,
        `expires_at`  BIGINT       NOT NULL,
        `created_at`  BIGINT       NOT NULL,
        PRIMARY KEY (`id`), KEY `owner` (`owner`), KEY `account` (`account_id`))]])
end)

local function today() return math.floor(Logic.now() / DAY) end

--- The card type's name from the config, or its key capitalised ("Gold").
local function tierName(t)
    local tier = Cfg().cards.tiers[t]
    return tier and Logic.text(tier.name, 1, 20) or (t:sub(1, 1):upper() .. t:sub(2))
end

local function metadata(card)
    return {
        cardId = card.id, last4 = card.last4, holder = card.holder, tier = card.tier,
        description = ('%s · •••• %s · %s'):format(tierName(card.tier), card.last4, card.holder),
    }
end

local function owned(identifier, cardId)
    return MySQL.single.await('SELECT * FROM lwk_bank_cards WHERE id = ? AND owner = ?', { tonumber(cardId), identifier })
end

--- Cards for the UI. At an ATM with items on, only the cards the player is carrying.
function Cards.forPlayer(src, identifier)
    if not Cfg().features.cards then return {} end
    local session = Bank.session(src)
    local held = session and session.mode == 'atm' and Inv.enabled() and Inv.heldCards(src, Cfg().cards.item)
    local out = {}
    for _, c in ipairs(MySQL.query.await('SELECT * FROM lwk_bank_cards WHERE owner = ? ORDER BY id', { identifier })) do
        if not held or held[tostring(c.id)] then
            out[#out + 1] = {
                id = tostring(c.id), accountId = tostring(c.account_id), tier = c.tier, last4 = c.last4,
                holder = c.holder, expiresAt = c.expires_at, status = c.status, dailyLimit = c.daily_limit,
                spentToday = c.spent_day == today() and c.spent_today or 0, autoRenew = Logic.flag(c.auto_renew),
            }
        end
    end
    return out
end

function Cards.deleteForAccount(accountId)
    MySQL.update.await('DELETE FROM lwk_bank_cards WHERE account_id = ?', { accountId })
end

-- ATM -------------------------------------------------------------------------------------
-- verifyPin sets session.card; ATM cash moves only work on that card's account.

Bank.action('verifyPin', function(src, identifier, p, session)
    local card = owned(identifier, p.cardId)
    if not card then return { ok = false, error = L('err_card_missing') } end
    if card.status ~= 'active' then return { ok = false, error = L('err_card_unusable') } end
    if card.expires_at < Logic.now() then return { ok = false, error = L('err_card_expired') } end
    if Inv.enabled() and not Inv.heldCards(src, Cfg().cards.item)[tostring(card.id)] then
        return { ok = false, error = L('err_card_not_held') }
    end
    if type(p.pin) ~= 'string' or not p.pin:match('^%d%d%d%d$') then return { ok = false, error = L('err_pin_format') } end
    -- ponytail: bcrypt runs on the main thread; fine for a 4-digit PIN check every few seconds per player.
    if VerifyPasswordHash(p.pin, card.pin_hash) then
        MySQL.update.await('UPDATE lwk_bank_cards SET pin_fails = 0 WHERE id = ?', { card.id })
        session.card = card.id
        return { ok = true }
    end
    local fails = card.pin_fails + 1
    local limit = Cfg().cards.pinAttempts
    if fails >= limit then
        MySQL.update.await("UPDATE lwk_bank_cards SET pin_fails = 0, status = 'blocked' WHERE id = ?", { card.id })
        Logs.event(src, 'card', 'Card frozen after wrong PINs', '•••• ' .. card.last4)
        return { ok = false, error = L('err_pin_frozen') }
    end
    MySQL.update.await('UPDATE lwk_bank_cards SET pin_fails = ? WHERE id = ?', { fails, card.id })
    return { ok = false, error = L('err_pin_wrong', limit - fails) }
end)

--- ATM guard for a cash move on `row`: the verified card must draw on it and have limit left.
function Cards.atmAllows(src, row, amount, withdrawing)
    local session = Bank.session(src)
    local card = session and session.card and MySQL.single.await('SELECT * FROM lwk_bank_cards WHERE id = ?', { session.card })
    if not card or card.account_id ~= row.id or card.status ~= 'active' then return false, L('err_card_session') end
    if withdrawing then
        local spent = card.spent_day == today() and card.spent_today or 0
        if spent + amount > card.daily_limit then return false, L('err_card_limit') end
    end
    return true
end

function Cards.recordSpend(src, amount)
    local session = Bank.session(src)
    if not session or not session.card then return end
    MySQL.update.await([[UPDATE lwk_bank_cards
        SET spent_today = IF(spent_day = ?, spent_today, 0) + ?, spent_day = ? WHERE id = ?]],
        { today(), amount, today(), session.card })
end

-- Management (bank only) ------------------------------------------------------------------

local function feeFrom(card, fee, label, src)
    if fee <= 0 then return true end
    local row = Accounts.byId(card.account_id)
    if not row or not Accounts.debit(row, fee, src) then return false end
    Accounts.log(row.id, 'fee', fee, label)
    return true
end

local function enabled() return Cfg().features.cards end

Bank.action('cardOrder', function(src, identifier, p)
    if not enabled() then return fail(L('err_disabled')) end
    local cfg = Cfg().cards
    local tier = cfg.tiers[p.tier] and p.tier
    if not tier then return fail(L('err_card_tier')) end
    local row, err = Accounts.open(src, identifier, p.accountId)
    if not row then return fail(err) end
    if not row.perms.withdraw then return fail(L('err_perm_withdraw')) end
    if MySQL.scalar.await('SELECT COUNT(*) FROM lwk_bank_cards WHERE owner = ?', { identifier }) >= cfg.maxCards then
        return fail(L('err_card_max', cfg.maxCards))
    end
    local fee = cfg.tiers[tier].fee
    if fee > 0 and not Accounts.debit(row, fee, src) then return fail(L('err_fee_account', fee)) end
    if fee > 0 then Accounts.log(row.id, 'fee', fee, L('tx_card_fee', tierName(tier))) end

    local pin = Logic.randomDigits(4)
    local id = MySQL.insert.await([[INSERT INTO lwk_bank_cards
        (account_id, owner, holder, tier, last4, pin_hash, daily_limit, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)]],
        { row.id, identifier, Bridge.name(src), tier, Logic.randomDigits(4), GetPasswordHash(pin),
          cfg.tiers[tier].dailyLimit, Logic.now() + cfg.validDays * DAY, Logic.now() })
    local card = MySQL.single.await('SELECT * FROM lwk_bank_cards WHERE id = ?', { id })
    if Inv.enabled() and not Inv.give(src, cfg.item, metadata(card)) then
        Bridge.notify(src, L('card_no_space'), 'error')
    end
    Bridge.notify(src, L('card_pin_notice', card.last4, pin), 'inform')
    Logs.event(src, 'card', 'Card ordered', ('%s •••• %s'):format(tier, card.last4))
    return ok(src)
end)

Bank.action('cardActivate', function(src, identifier, p)
    if not enabled() then return fail(L('err_disabled')) end
    local card = owned(identifier, p.cardId)
    if not card then return fail(L('err_card_missing')) end
    if card.status ~= 'inactive' then return ok(src) end
    local cfg = Cfg().cards
    if MySQL.scalar.await("SELECT COUNT(*) FROM lwk_bank_cards WHERE owner = ? AND status = 'active'", { identifier }) >= cfg.maxActive then
        return fail(L('err_card_active_max', cfg.maxActive))
    end
    if not feeFrom(card, cfg.activationFee, L('tx_card_activation', card.last4), src) then
        return fail(L('err_fee_account', cfg.activationFee))
    end
    MySQL.update.await("UPDATE lwk_bank_cards SET status = 'active' WHERE id = ?", { card.id })
    return ok(src)
end)

Bank.action('cardBlock', function(src, identifier, p)
    local card = owned(identifier, p.cardId)
    if not card or card.status == 'inactive' then return fail(L('err_card_missing')) end
    MySQL.update.await('UPDATE lwk_bank_cards SET status = ? WHERE id = ?', { p.blocked and 'blocked' or 'active', card.id })
    return ok(src)
end)

Bank.action('cardRenew', function(src, identifier, p)
    local card = owned(identifier, p.cardId)
    if not card then return fail(L('err_card_missing')) end
    local cfg = Cfg().cards
    if not feeFrom(card, cfg.renewalFee, L('tx_card_renewal', card.last4), src) then
        return fail(L('err_fee_account', cfg.renewalFee))
    end
    MySQL.update.await('UPDATE lwk_bank_cards SET expires_at = GREATEST(expires_at, ?) + ? WHERE id = ?',
        { Logic.now(), cfg.validDays * DAY, card.id })
    return ok(src)
end)

Bank.action('cardAutoRenew', function(src, identifier, p)
    local card = owned(identifier, p.cardId)
    if not card then return fail(L('err_card_missing')) end
    MySQL.update.await('UPDATE lwk_bank_cards SET auto_renew = ? WHERE id = ?', { p.enabled and 1 or 0, card.id })
    return ok(src)
end)

Bank.action('cardPin', function(src, identifier, p)
    local card = owned(identifier, p.cardId)
    if not card then return fail(L('err_card_missing')) end
    if type(p.pin) ~= 'string' or not p.pin:match('^%d%d%d%d$') then return fail(L('err_pin_format')) end
    MySQL.update.await('UPDATE lwk_bank_cards SET pin_hash = ?, pin_fails = 0 WHERE id = ?', { GetPasswordHash(p.pin), card.id })
    return ok(src)
end)

Bank.action('cardLimit', function(src, identifier, p)
    if not Cfg().features.customCardLimits then return fail(L('err_disabled')) end
    local card = owned(identifier, p.cardId)
    if not card then return fail(L('err_card_missing')) end
    local max = Cfg().cards.tiers[card.tier].dailyLimit
    local limit = tonumber(p.limit)
    if not limit or limit < 0 or limit % 1 ~= 0 or limit > max then return fail(L('err_card_limit_range', max)) end
    MySQL.update.await('UPDATE lwk_bank_cards SET daily_limit = ? WHERE id = ?', { limit, card.id })
    return ok(src)
end)

Bank.action('cardDelete', function(src, identifier, p)
    local card = owned(identifier, p.cardId)
    if not card then return fail(L('err_card_missing')) end
    if Inv.enabled() then Inv.removeCard(src, Cfg().cards.item, card.id) end
    MySQL.update.await('DELETE FROM lwk_bank_cards WHERE id = ?', { card.id })
    Logs.event(src, 'card', 'Card destroyed', '•••• ' .. card.last4)
    return ok(src)
end)

-- Auto-renewal: daily at 04:00, renew cards expiring within a day if the account can pay.
lib.cron.new('0 4 * * *', function()
    local cfg = Cfg().cards
    local due = MySQL.query.await('SELECT * FROM lwk_bank_cards WHERE auto_renew = 1 AND expires_at < ?', { Logic.now() + DAY })
    for _, card in ipairs(due) do
        if feeFrom(card, cfg.renewalFee, L('tx_card_renewal', card.last4)) then
            MySQL.update.await('UPDATE lwk_bank_cards SET expires_at = GREATEST(expires_at, ?) + ? WHERE id = ?',
                { Logic.now(), cfg.validDays * DAY, card.id })
        end
    end
end)
