-- LWK Bank configuration.
-- These are the DEFAULTS. Admins can change almost everything in-game with /bankconfig;
-- those changes are saved to the database and win over this file.

Config = {
    -- General -------------------------------------------------------------------
    locale    = 'en',          -- a file in config/locales/ (see README > Language to add one)
    -- cdecad = the bank balance is the active /setciv civilian's CDECAD account (cash, jobs
    -- and gangs still come from qbox/qb/esx if one runs). Reads CDE_CAD_API_URL,
    -- CDE_CAD_API_KEY and CDE_CAD_RESOURCE from server.cfg. auto only picks cdecad when
    -- no framework is running, so set it explicitly on a qb/qbox/esx server.
    framework = 'auto',        -- auto | qbox | qb | esx | cdecad
    inventory = 'auto',        -- auto | ox | qb | qs | none   (none = cards live only in the bank)
    target    = 'auto',        -- auto | ox | qb | none        (none = "Press E")
    -- none with cdecad: framework bills are keyed by citizenid/license, and in cdecad mode a
    -- player is their /setciv's SSN, so framework bills would never match anyone.
    billing   = 'auto',        -- auto | okok | esx | qb | none
    notify    = 'auto',        -- auto | ox | okok | wasabi | esx | qb   (auto = okokNotify/wasabi_notify if running, else ox_lib)
    debug     = false,         -- adds /bank and /atm test commands

    -- Branding --------------------------------------------------------------------
    bankName = 'LWK Bank',
    accent   = '#c8f031',      -- any hex colour; text on it switches dark/light automatically
    currency = 'USD',          -- ISO 4217 code, number formatting only

    -- Sections: false removes them from the UI entirely ---------------------------
    features = {
        cards            = true,
        savings          = true,
        loans            = true,
        bills            = true,
        accounts         = true,
        business         = true,   -- job bosses get a business account
        multiTransfer    = true,
        contacts         = true,
        receipts         = true,
        customIban       = true,
        customCardLimits = true,
    },

    sound = { enabled = true, volume = 0.5 },

    -- Cards -----------------------------------------------------------------------
    cards = {
        tiers = {
            standard = { dailyLimit = 5000,   fee = 250 },
            premium  = { dailyLimit = 25000,  fee = 1500 },
            gold     = { dailyLimit = 100000, fee = 7500 },
        },
        maxCards      = 10,
        maxActive     = 3,
        activationFee = 100,
        renewalFee    = 500,
        validDays     = 90,
        pinAttempts   = 3,        -- wrong PINs before the card is frozen
        item          = 'bank_card',
    },

    -- Weekly interest % on savings, by account type ---------------------------------
    savingsRates = { personal = 0.5, shared = 0.75, business = 1.0 },
    interestDay  = 1,             -- day of week interest is paid (1 = Sunday ... 7 = Saturday)

    -- Loans -------------------------------------------------------------------------
    loans = {
        plans = {
            { id = 'starter',   name = 'Starter',   min = 1000,   max = 10000,   rate = 12 },
            { id = 'standard',  name = 'Standard',  min = 10000,  max = 50000,   rate = 10 },
            { id = 'premium',   name = 'Premium',   min = 50000,  max = 150000,  rate = 8 },
            { id = 'executive', name = 'Executive', min = 150000, max = 500000,  rate = 6 },
            { id = 'custom',    name = 'Custom',    min = 500,    max = 1000000, rate = 14 },
        },
        terms             = { 12, 24, 36, 48, 60 },  -- repayment days
        maxActive         = 4,
        balanceMultiplier = 3,                       -- borrowing limit = total balance x this
        graceHours        = 6,
        lateFee           = 5,                       -- % of the missed payment added when late
        startingScore     = 650,
        bands = {
            { min = 300, label = 'Very Poor', adjust = 3 },
            { min = 500, label = 'Poor',      adjust = 2 },
            { min = 580, label = 'Fair',      adjust = 1 },
            { min = 670, label = 'Good',      adjust = 0 },
            { min = 740, label = 'Very Good', adjust = -1.5 },
            { min = 800, label = 'Excellent', adjust = -3 },
        },
    },

    -- Accounts ----------------------------------------------------------------------
    accounts = {
        maxOwned    = 5,
        creationFee = 500,      -- cash
        ibanFee     = 2500,
        ibanPrefix  = 'LW',
    },

    business = {
        -- What non-boss employees may do on their job's business account.
        employeePerms = { deposit = true, withdraw = false, transfer = false, loans = false },
    },

    -- Receipts ----------------------------------------------------------------------
    receipts = { item = 'bank_receipt' },

    -- World -------------------------------------------------------------------------
    interaction = {
        distance = 2.0,
        openAnim = true,          -- short animation + progress before the UI opens
        openTime = 1500,          -- ms
    },
    blips = { enabled = true, sprite = 108, color = 2, scale = 0.7 },
    atmModels = { 'prop_atm_01', 'prop_atm_02', 'prop_atm_03', 'prop_fleeca_atm' },
    -- ATMs built into a building instead of placed as a prop can't be found by model.
    -- List their positions here (or stand at one in /bankconfig > World > Add ATM here).
    atmSpots = {
        { x = 147.47, y = -1036.22, z = 29.37 },   -- Legion Square Fleeca, outside wall
        { x = 145.84, y = -1035.63, z = 29.37 },
    },
    banks = {
        { label = 'Legion Square',  coords = vec4(149.05, -1041.3, 29.37, 340.0) },
        { label = 'Hawick Avenue',  coords = vec4(313.32, -280.03, 54.17, 340.0) },
        { label = 'Burton',         coords = vec4(-351.94, -50.72, 49.04, 340.0) },
        { label = 'Rockford Hills', coords = vec4(-1212.68, -331.83, 37.78, 30.0) },
        { label = 'Great Ocean',    coords = vec4(-2961.67, 482.31, 15.7, 90.0) },
        { label = 'Harmony',        coords = vec4(1175.64, 2707.71, 38.09, 180.0) },
        { label = 'Pacific Standard', coords = vec4(247.65, 223.87, 106.29, 160.0) },
        { label = 'Paleto Bay',     coords = vec4(-111.98, 6470.56, 31.63, 135.0) },
    },

    -- Staff -------------------------------------------------------------------------
    admin = {
        ace       = 'lwk_bank.admin',            -- add_ace group.admin lwk_bank.admin allow
        esxGroups = { 'admin', 'superadmin' },
    },
    logs = {
        webhook    = '',          -- Discord webhook URL ('' = off)
        oxLogger   = false,       -- also send to ox_lib's logger (set the ox:logger convar)
        bigAmount  = 50000,       -- withdrawals/transfers at or above this are flagged
    },
}
