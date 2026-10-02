-- NUI bridge: opens/closes the UI and forwards every UI action to the server.

local isOpen = false

--- Bank name as currently configured (the editor can change it live).
local function bankName()
    return (GlobalState.lwk_bank_world or Config).bankName
end

-- Every action the UI can send (see web/src/nui.ts). Each one maps 1:1 to a
-- server callback 'lwk_bank:<event>' that returns a Result.
local ACTIONS = {
    'deposit', 'withdraw', 'transfer', 'contactSave', 'contactDelete', 'verifyPin',
    'cardOrder', 'cardActivate', 'cardBlock', 'cardRenew', 'cardAutoRenew', 'cardPin', 'cardLimit', 'cardDelete',
    'savingsMove', 'goalCreate', 'goalMove', 'goalDelete',
    'loanApply', 'loanPay', 'billPay', 'billPayAll', 'receiptPrint',
    'accountCreate', 'accountRename', 'accountDelete', 'accountIban', 'memberAdd', 'memberRemove', 'memberPerms',
    'adminConfigSave', 'adminConfigReset',
}

for _, action in ipairs(ACTIONS) do
    RegisterNUICallback(action, function(data, cb)
        cb(lib.callback.await('lwk_bank:' .. action, false, data) or { ok = false, error = L('err_generic') })
    end)
end

local function close()
    isOpen = false
    SetNuiFocus(false, false)
    lib.callback.await('lwk_bank:close', false)
end

RegisterNUICallback('close', function(_, cb)
    close()
    cb({})
end)

-- CDECAD mode: once, offer to move the player's bank from before CDECAD to their civilian
-- (server/cdecad.lua decides whether there's anything to move).
local prompting = false
local function offerCdecadMove()
    if not GlobalState.lwk_bank_cdecadMove then return end
    local offer = lib.callback.await('lwk_bank:cdecadOffer', false)
    if not offer then return end
    local answer = lib.alertDialog({
        header = L('cdecad_move_title'),
        content = L('cdecad_move_body', offer.name, offer.bank),
        centered = true, cancel = true,
        labels = { confirm = L('cdecad_move_yes'), cancel = L('cdecad_move_no') },
    })
    local moved = lib.callback.await('lwk_bank:cdecadMove', false, answer == 'confirm')
    if answer == 'confirm' then
        Notify(moved and L('cdecad_moved', offer.name) or L('err_cdecad_move'), moved and 'success' or 'error')
    end
end

--- Opens the bank ('bank') or the ATM flow ('atm'). Returns false if the server refused.
function OpenBank(mode)
    if isOpen or prompting then return false end
    if mode ~= 'atm' then
        prompting = true
        pcall(offerCdecadMove)
        prompting = false
    end
    local data = lib.callback.await('lwk_bank:open', false, mode)
    if not data then
        Notify(L('err_not_here'), 'error')
        return false
    end
    isOpen = true
    SendNUIMessage({ action = mode == 'atm' and 'openAtm' or 'open', data = data })
    SetNuiFocus(true, true)
    return true
end
exports('OpenBank', OpenBank)

RegisterNetEvent('lwk_bank:update', function(data)
    if isOpen then SendNUIMessage({ action = 'update', data = data }) end
end)

-- Money arrived from someone else: a toast in the UI if it's open, a notification if not.
RegisterNetEvent('lwk_bank:incoming', function(amount, from)
    if isOpen then
        SendNUIMessage({ action = 'incoming', amount = amount, from = from })
    else
        Notify(L('incoming', amount, from), 'success')
    end
end)

-- The server can force the UI shut (e.g. account deleted by an admin).
RegisterNetEvent('lwk_bank:forceClose', function()
    if isOpen then
        SendNUIMessage({ action = 'close' })
        close()
    end
end)

-- /bankconfig: the server checked admin rights and sent the editable config.
RegisterNetEvent('lwk_bank:openConfig', function(data)
    if isOpen then return end
    isOpen = true
    SendNUIMessage({ action = 'openConfig', config = data })
    SetNuiFocus(true, true)
end)

-- Using a receipt item: show the printed receipt. Old receipts without details still
-- show their label/description.
local function showReceipt(metadata)
    if isOpen or type(metadata) ~= 'table' then return end
    local world = GlobalState.lwk_bank_world or Config
    isOpen = true
    SendNUIMessage({
        action = 'receipt',
        receipt = metadata.receipt or { title = metadata.label, label = metadata.description },
        view = { ui = Locale.ui(), intl = Locale.intl(), currency = world.currency, bankName = world.bankName, accent = world.accent },
    })
    SetNuiFocus(true, true)
end
RegisterNetEvent('lwk_bank:showReceipt', showReceipt)
-- ox_inventory: client = { export = 'lwk_bank.useReceipt' } on the item.
exports('useReceipt', function(_, slot) showReceipt(slot and slot.metadata) end)

-- "Add bank here" in the editor: where the admin is standing.
RegisterNUICallback('adminHere', function(_, cb)
    local pos = GetEntityCoords(cache.ped)
    local r = function(n) return math.floor(n * 100 + 0.5) / 100 end
    cb({ x = r(pos.x), y = r(pos.y), z = r(pos.z), heading = r(GetEntityHeading(cache.ped)) })
end)

RegisterNetEvent('lwk_bank:adminInfo', function(text)
    lib.alertDialog({ header = bankName(), content = text, centered = true, size = 'lg' })
end)

AddEventHandler('onResourceStop', function(res)
    if res == GetCurrentResourceName() and isOpen then SetNuiFocus(false, false) end
end)

if Config.debug then
    RegisterCommand('bank', function() OpenBank('bank') end, false)
    RegisterCommand('atm', function() OpenBank('atm') end, false)
end
