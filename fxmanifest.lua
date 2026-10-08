fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'lwk_bank'
author 'LWK Development'
version '1.3.0'
description 'LWK Bank - banking for QBCore, Qbox and ESX'
repository 'https://github.com/lwkjacob/lwk_bank'

ui_page 'web/dist/index.html'

files {
  'web/dist/index.html',
  'web/dist/assets/*',
  'web/dist/sounds/*',
  'config/locales/*.json',
  'images/*.png',
}

shared_scripts {
  '@ox_lib/init.lua',
  'config/config.lua',
  'shared/locale.lua',
  'config/bridge/notify.lua',
}

server_scripts {
  '@oxmysql/lib/MySQL.lua',
  'server/settings.lua',
  'config/bridge/framework.lua',
  'config/bridge/inventory.lua',
  'config/bridge/billing.lua',
  'server/logic.lua',
  'server/logs.lua',
  'server/business.lua',
  'server/accounts.lua',
  'server/main.lua',
  'server/manage.lua',
  'server/cards.lua',
  'server/savings.lua',
  'server/loans.lua',
  'server/bills.lua',
  'server/admin.lua',
  'server/compat.lua',
  'server/import.lua',
  'server/integrations.lua',
  'server/cdecad.lua',
}

client_scripts {
  'client/main.lua',
  'client/world.lua',
}

dependencies {
  'ox_lib',
  'oxmysql',
}

-- Drop-in replacement: scripts that depend on or call these banks get LWK Bank instead
-- (server/compat.lua answers their exports). Remove the original resources.
provide 'Renewed-Banking'
provide 'qb-banking'
provide 'qb-management'
provide 'okokBanking'
provide 'fd_banking'
provide 'tgg-banking'
provide 'tgiann-bank'
provide 'wasabi_banking'
provide 'p_banking'
