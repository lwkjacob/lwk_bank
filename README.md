# LWK Bank

A free, open-source bank for FiveM by **LWK Development**. Animated 3D UI, real ATMs and bank cards, savings goals, loans with credit scores, bills, shared and business accounts, and an in-game settings editor, so you never have to touch a config file.

![Overview](.github/showcase.png)

Works with **Qbox, QBCore and ESX** (detected automatically), and with **[CDECAD](#cdecad)**, where a player's bank balance is their [CDECAD](https://cdecad.com/) civilian's account.

## Features

- **Bank and ATM.** Bank counters at every Fleeca/Pacific branch, plus every ATM prop in the map. A short animation plays before the UI opens.
- **Transfers** by IBAN or saved contact, to several people at once. Hold-to-confirm, and the receiver gets a live toast.
- **Cards** in three tiers. Each card has a PIN, a daily limit, freeze, renewal, auto-renew, and is a real inventory item (ox / qb / qs). There's also a no-items mode.
- **Savings** with weekly interest and savings goals.
- **Loans** with plans, terms, a 300–850 credit score that moves with how you pay, a grace period, late fees and auto-collection.
- **Bills** read from okokBilling, esx_billing or QBCore phone invoices, plus financed vehicles from jg-dealerships. Pay one or all of them, and print receipts as items.
- **Accounts**: personal, shared (members with per-permission access) and business accounts for job and gang bosses. On ESX, business accounts use `esx_addonaccount`, so boss menus keep working.
- **Drop-in replacement** for Renewed-Banking, qb-banking, qb-management and okokBanking: scripts that call their exports keep working, and `/bankimport` brings their balances over.
- **Notifications** through ox_lib, okokNotify, wasabi_notify, or the ESX / QBCore / Qbox built-ins.
- **Logs** to a Discord webhook and/or ox_lib's logger. Big amounts are flagged.
- **Admin tools**: `/bankconfig` (in-game settings), plus commands to look up players, reset PINs, unfreeze cards and set credit scores.
- **Translations**: every string lives in `config/locales/<code>.json`, and dates and money use the language's own formats.
- **Sounds**: short, quiet, realistic (CC0). They can be turned off or replaced.

## Compatibility

Everything is detected automatically. Each one can also be forced in `config/config.lua`.

| Frameworks | Status | Notes |
| --- | :---: | --- |
| qbox | ✅ | |
| qb-core | ✅ | |
| esx | ✅ | |
| CDECAD | ✅ | Set `framework = 'cdecad'`. Runs alone or on top of the three above. See [CDECAD](#cdecad) |
| custom | ⚠️ | Requires manual implementation (`config/bridge/framework.lua`) |

| Interactions | Status | Notes |
| --- | :---: | --- |
| ox_target | ✅ | |
| qb-target | ✅ | |
| none | ✅ | Built-in "Press E" prompt |
| custom | ⚠️ | Requires manual implementation (`client/world.lua`) |

| Inventories | Status | Notes |
| --- | :---: | --- |
| ox_inventory | ✅ | Cards and receipts as items, item images included |
| qb-inventory | ✅ | Cards and receipts as items |
| qs-inventory | ✅ | Cards and receipts as items |
| none | ✅ | Cards live in the bank app only |
| custom | ⚠️ | Requires manual implementation (`config/bridge/inventory.lua`) |

| Notifications | Status | Notes |
| --- | :---: | --- |
| ox_lib | ✅ | Default |
| esx | ✅ | |
| qb | ✅ | Uses qbx_core's on Qbox |
| okok | ✅ | okokNotify |
| wasabi_notify | ✅ | |
| custom | ⚠️ | Requires manual implementation (`config/bridge/notify.lua`) |

| Billing | Status | Notes |
| --- | :---: | --- |
| okokBilling | ✅ | Unpaid invoices under Bills |
| esx_billing | ✅ | Unpaid invoices under Bills |
| qb (phone invoices) | ✅ | Unpaid invoices under Bills |
| custom | ⚠️ | Requires manual implementation (`config/bridge/billing.lua`) |

| Banking | Status | Notes |
| --- | :---: | --- |
| Renewed-Banking | ✅ | Drop-in replacement, balances imported |
| qb-banking | ✅ | Drop-in replacement, balances imported |
| qb-management | ✅ | Drop-in replacement, balances imported |
| okokBanking | ✅ | Drop-in replacement, balances imported |
| esx_addonaccount | ✅ | Keeps holding society money on ESX when running; without it the bank holds it |

| Other | Status | Notes |
| --- | :---: | --- |
| jg-dealerships | ✅ | Financed vehicles appear under the player's bills |
| lation_shops | ✅ | Shop balances go through LWK Bank; bank purchases show in the player's activity |

## Requirements

| Resource | Why |
| --- | --- |
| [ox_lib](https://github.com/overextended/ox_lib) | callbacks, notifications, commands, progress bar, cron |
| [oxmysql](https://github.com/overextended/oxmysql) | database |
| qbx_core, qb-core **or** es_extended | your framework (optional in CDECAD mode) |
| CDECAD *(optional)* | the CDECAD resource and its `server.cfg` convars, for [CDECAD mode](#cdecad) |
| ox_target or qb-target *(optional)* | look-at interaction. Without one, players get a "Press E" prompt |
| ox_inventory, qb-inventory or qs-inventory *(optional)* | cards and receipts as items |
| okokBilling / esx_billing / QBCore invoices *(optional)* | the Bills tab |

## Installation

1. **Download** `lwk_bank.zip` from the [latest release](https://github.com/lwkjacob/lwk_bank/releases/latest) and extract the `lwk_bank` folder into your `resources`. Keep the folder name **`lwk_bank`** (if you download the source code instead, rename `lwk_bank-main`). Other scripts use that name to call its exports.
2. **Start it after** your framework, ox_lib, oxmysql, target and inventory, in `server.cfg`:
   ```cfg
   ensure ox_lib
   ensure oxmysql
   # ...framework, target, inventory...
   ensure lwk_bank
   ```
3. **Give admins access** to `/bankconfig` and the admin commands:
   ```cfg
   add_ace group.admin lwk_bank.admin allow
   ```
   On ESX, the `admin` and `superadmin` groups also work (see `admin.esxGroups` in `config/config.lua`).
4. **Add the items** (skip this if you don't use an inventory). See [Items](#items) below.
5. **Remove your old bank** so two banks don't fight over the same counters and exports. Coming from Renewed-Banking, qb-banking, qb-management or okokBanking? Other scripts that call its exports keep working with LWK Bank, and you can bring the balances over: see [Switching from another bank](#switching-from-another-bank).
6. **Restart the server.** The database tables are created automatically on first start. `sql/install.sql` is there if you'd rather run it yourself.

That's it. Join the server, walk up to a bank counter or ATM, and press the target or E.

### Items

Item images are in `images/` (`bank_card.png`, `bank_receipt.png`). ox_inventory loads them straight from this resource. For qb/qs, copy them into your inventory's image folder (`qb-inventory/html/images`, `qs-inventory/html/images`).

**Using a receipt** opens it as a printed slip showing the date, account, amount and reference.

**ox_inventory** (also used by Qbox): `ox_inventory/data/items.lua`
```lua
['bank_card'] = {
    label = 'Bank Card', weight = 10, stack = false, close = true,
    description = 'A debit card. Use it at any ATM.',
    client = { image = 'nui://lwk_bank/images/bank_card.png' },
},
['bank_receipt'] = {
    label = 'Bank Receipt', weight = 1, stack = false, close = true,
    client = { image = 'nui://lwk_bank/images/bank_receipt.png', export = 'lwk_bank.useReceipt' },
},
```

**qb-inventory**: `qb-core/shared/items.lua`
```lua
bank_card    = { name = 'bank_card',    label = 'Bank Card',    weight = 10, type = 'item', image = 'bank_card.png',    unique = true, useable = false, shouldClose = true, description = 'A debit card. Use it at any ATM.' },
bank_receipt = { name = 'bank_receipt', label = 'Bank Receipt', weight = 1,  type = 'item', image = 'bank_receipt.png', unique = true, useable = true, shouldClose = true, description = 'A bank receipt.' },
```

**qs-inventory**: `qs-inventory/shared/items.lua`
```lua
['bank_card']    = { ['name'] = 'bank_card',    ['label'] = 'Bank Card',    ['weight'] = 10, ['type'] = 'item', ['image'] = 'bank_card.png',    ['unique'] = true, ['useable'] = false, ['shouldClose'] = true, ['description'] = 'A debit card. Use it at any ATM.' },
['bank_receipt'] = { ['name'] = 'bank_receipt', ['label'] = 'Bank Receipt', ['weight'] = 1,  ['type'] = 'item', ['image'] = 'bank_receipt.png', ['unique'] = true, ['useable'] = true, ['shouldClose'] = true, ['description'] = 'A bank receipt.' },
```

When a card is ordered, the player gets the item. At an ATM they can only use cards they're carrying. With no inventory (`inventory = 'none'`), cards live only in the bank app and ATMs show all of them.

## Configuration

You have two options:

- **In game (recommended):** type **`/bankconfig`**. Every option has a label and a short explanation. Changes apply instantly for everyone, with no restart. "Add bank here" saves your current position as a new bank counter. "Reset to defaults" goes back to `config.lua`.
- **`config/config.lua`:** the defaults. Anything saved in-game overrides this file. A few things can only be set here, because changing them live could break the server or lock staff out:
  - `framework`, `inventory`, `target`, `billing`, `notify` (all `auto` by default)
  - `debug` (adds `/bank` and `/atm` test commands)
  - `admin` (who counts as staff)
  - `interestDay` (needs a restart)

Only the settings you actually change in `/bankconfig` are saved, so anything you never touched there still follows `config.lua`. The server console lists which settings are overridden on start.

### ATMs that don't respond

Most ATMs are props, found by model (`atmModels`). A few are built into a building's walls (for example, outside the Legion Square Fleeca) and can't be found that way. List those in `atmSpots`, or stand at one and use `/bankconfig` → World → **Add ATM here**.

### Language

Set `locale` (in `/bankconfig` → General, or `config/config.lua`) to the name of a file in `config/locales/`. To add a language:

1. Copy `config/locales/en.json` to `config/locales/<code>.json` (e.g. `de.json`).
2. Set `meta.intl` to the language's locale code (e.g. `de-DE`). Dates and money formats follow it.
3. Translate the values, never the keys. Keep placeholders as they are: `{name}`, `{amount}` and `%s`.

Missing strings fall back to English, so a half-done translation still works. Pull requests with new languages are welcome!

### Branding

Change `bankName`, `accent` (any hex colour; text on it switches between dark and light automatically) and `currency` (any ISO code, e.g. `EUR`) in `/bankconfig` → General.

### Notifications

`notify` in `config/config.lua` picks where messages appear: `ox` (ox_lib), `okok` (okokNotify), `wasabi` (wasabi_notify), `esx` or `qb` (the framework's own; on Qbox, `qb` uses qbx_core's). `auto` uses okokNotify or wasabi_notify if one is running, otherwise ox_lib.

## CDECAD

In CDECAD mode, a player's main bank balance **is** the bank account of the civilian they picked with `/setciv`. The CDECAD website, the CDECAD phone app, cde-economy and LWK Bank all show the same number, because there is only one: LWK Bank reads and moves it through the CAD's API instead of keeping its own copy.

**Setup:**

1. Keep the CDE CAD convars you already have in `server.cfg`. LWK Bank reads the same ones, and picks up a console `set` without a restart:
   ```cfg
   set CDE_CAD_API_URL "https://your-cdecad-instance.com/api"
   set CDE_CAD_API_KEY "your-fivem-api-key"
   set CDE_CAD_RESOURCE "CDECAD"   # only if you renamed the CDECAD folder
   ```
2. In `config/config.lua`, set `framework = 'cdecad'` and `billing = 'none'`. With no framework installed, `auto` picks CDECAD on its own, but on a Qbox, QBCore or ESX server it picks the framework, so set it.
3. Start CDECAD before LWK Bank:
   ```cfg
   ensure CDECAD
   ensure lwk_bank
   ```

**What changes:**

- **Who the player is.** The active `/setciv` civilian, by SSN. A player with no civilian selected is told to run `/setciv` when they open the bank. Each civilian has their own cards, loans, savings, contacts and credit score, so switching civilians switches all of it.
- **Cash, jobs and gangs** still come from Qbox, QBCore or ESX when one is running, so business accounts for bosses keep working. With no framework, cash is a wallet per civilian stored in LWK Bank, and there are no business accounts because nobody has a job.
- **Money moves atomically on the CAD.** It checks the balance and debits in one step, refuses frozen accounts, and a retried deposit is never paid twice.

**What to know:**

- Your framework's salaries and bank charges still go to the framework's bank, which LWK Bank no longer shows in this mode. Pay wages into CDECAD instead, for example with cde-economy's jobs.
- Set `billing = 'none'`. Framework bills are stored under the framework's character ID, and in this mode a player is their civilian's SSN, so those bills would never show up. CDECAD's own invoices are paid from the CDECAD phone or website.
- Balances are cached for 5 seconds to stay under the CAD's request limit. A change made in LWK Bank shows immediately; a change made on the website can take up to 5 seconds to appear here.
- On ESX, business accounts are held in LWK Bank rather than `esx_addonaccount`.
- Exports from the old banks that look up a player by citizenid or license won't find a CDECAD civilian. Business and shared account exports work as usual.
- **Switching an existing server to CDECAD.** Bank data from before CDECAD (accounts, savings, cards, loans, contacts, credit score) is saved under the player's character. The first time they open the bank at a branch with a civilian selected, they're asked whether to move it, together with the character's framework bank money, to that civilian. It moves once, to the first civilian they say yes for; saying no asks again next session. Needs Qbox, QBCore or ESX underneath (standalone CDECAD servers have nothing to move).

## Switching from another bank

LWK Bank replaces **Renewed-Banking, qb-banking, qb-management and okokBanking**. It `provide`s their names and answers their exports. So job scripts, boss menus, shops (e.g. lation_shops) and anything else written for your old bank keep working, with their money in LWK Bank business accounts:

| Old bank | Exports that keep working |
| --- | --- |
| Renewed-Banking | `getAccountMoney`, `addAccountMoney`, `removeAccountMoney`, `handleTransaction`, `GetJobAccount`, `CreateJobAccount`, `addAccountMember`, `removeAccountMember`, `getAccountTransactions`, `changeAccountName` |
| qb-banking | `AddMoney`, `RemoveMoney`, `AddGangMoney`, `RemoveGangMoney`, `GetAccount`, `GetGangAccount`, `GetAccountBalance`, `CreatePlayerAccount`, `CreateJobAccount`, `CreateGangAccount`, `CreateBankStatement` |
| qb-management | `GetAccount`, `GetGangAccount`, `AddMoney`, `RemoveMoney`, `AddGangMoney`, `RemoveGangMoney` |
| okokBanking | `GetAccount`, `AddMoney`, `RemoveMoney`, `AddTransaction`, `GetPlayerTransactions` |

**Steps:**

1. Stop the server, remove the old bank from `resources` (or its `ensure` line), and add LWK Bank. If both are running, LWK Bank prints a warning on start.
2. Start the server and preview the import from the server console (or in game as an admin):
   ```
   bankimport renewed
   ```
   Sources: `renewed`, `qb` (qb-banking), `qbmanagement` (older qb-management `management_funds`), `okok`. The preview changes nothing. It shows how many accounts of each type would come over and how much money.
3. Run it for real:
   ```
   bankimport renewed confirm
   ```
   Society, job and gang balances go to business accounts. Shared accounts keep their owner and members, and extra player accounts come over as personal accounts. Each source imports once; add `force` to repeat it.

Players' main bank balance is framework money in all of these banks, so it is already in LWK Bank and isn't imported. If the preview lists a type that is really players' main account (okokBanking stores one per player, usually `personal`), leave it out so it isn't counted twice: `bankimport okok confirm skip=personal`.

## Works with

- **jg-dealerships**: every financed vehicle's next payment shows up under Bills. Paying it goes through jg-dealerships itself, from any of the player's accounts.
- **lation_shops**: shop balances use LWK Bank through its Renewed-Banking / qb-banking / okokBanking support, and shop purchases or sales paid by bank show up in the player's activity.

## Commands

| Command | Who | What |
| --- | --- | --- |
| `/bankconfig` | admins | In-game settings editor |
| `/bankadmin <id or identifier>` | admins | A player's accounts, cards, loans and credit score |
| `/bankpin <id or identifier> <last 4>` | admins | Reset a card's PIN (the new PIN is sent to the player) |
| `/bankunfreeze <id or identifier> <last 4>` | admins | Unfreeze a card that was locked by wrong PINs |
| `/bankscore <id or identifier> <300-850>` | admins | Set a credit score |
| `/bankimport <source> [confirm] [skip=…] [force]` | admins, console | Import balances from another bank (see above) |
| `/bank`, `/atm` | everyone, only with `debug = true` | Open without walking to one |

Every admin action is logged.

## Exports

```lua
-- client: open the bank or the ATM screen from your own script (phone, NPC, etc.)
exports.lwk_bank:OpenBank('bank') -- or 'atm'

-- server: job/society money (business accounts), e.g. for shops, mechanics, billing
exports.lwk_bank:AddBusinessMoney('mechanic', 500, 'Repair')       --> true/false
exports.lwk_bank:RemoveBusinessMoney('mechanic', 200, 'Parts')     --> true/false
exports.lwk_bank:GetBusinessBalance('mechanic')                    --> number
```

Players' main account **is** their framework bank money, so anything that pays salaries or charges bank money through your framework shows up in LWK Bank automatically. In [CDECAD mode](#cdecad) it is their civilian's CDECAD account instead.

## Logs

In `/bankconfig` → Logs:
- **Discord webhook**: paste a webhook URL. Leave it empty to turn logs off.
- **ox_lib logger**: also send logs to ox_lib's logger (Datadog/Fivemanage/etc.; set the `ox:logger` convar).
- **Flag amounts from**: withdrawals and transfers at or above this amount are marked ⚠.

## Credits

- Made by **LWK Development**.
- Sounds are CC0. See `web/dist/sounds/CREDITS.txt`.
- Fonts: Archivo and JetBrains Mono (SIL Open Font License), bundled through Fontsource.
- UI libraries in the built bundle: React and three.js (MIT), GSAP ([standard no-charge license](https://gsap.com/standard-license)).

## Support

Free support is available in the [LWK Development Discord](https://discord.gg/99EuV7rzSp). Please include your framework, inventory, target, and any F8/server console errors.

## Recommended Hosting

I recommend and personally use [RocketNode](https://rocketnode.us/lwkdev) for hosting your FiveM server running this resource. Use code **LWKDEV** for 25% off.

![LWK Dev](.github/rocketnode.webp)

---

## License

[GPL-3.0](LICENSE) © LWK Development.

You can use, modify and share LWK Bank freely, on any server. If you distribute it or a modified version, it must stay open source under the same license, with the full source code included, so it can't be encrypted, escrowed or made closed source.

Bundled third-party parts keep their own licenses (see Credits).
