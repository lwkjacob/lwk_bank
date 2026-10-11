import { useEffect, useRef } from 'react';

/* ------------------------------------------------------------------ *
 * NUI contract
 *
 * Lua -> UI  (SendNUIMessage)
 *   { action: 'open',    data: BankData }   open the bank (branch/desk)
 *   { action: 'openAtm', data: BankData }   open the ATM flow
 *   { action: 'update',  data: BankData }   push fresh data while open
 *   { action: 'close' }                     force close
 *
 * UI -> Lua  (RegisterNUICallback). Every callback below answers with a
 * Result: cb({ ok = true, data = <fresh BankData> }) or cb({ ok = false, error = '...' }).
 * Exceptions: close -> {}, verifyPin -> { ok, error? }.
 *
 *   close          {}
 *   verifyPin      { cardId, pin }
 *   deposit        { accountId, amount, atm? }
 *   withdraw       { accountId, amount, atm? }
 *   transfer       { accountId, ibans: string[], amount, note }   amount is per recipient
 *   contactSave    { name, iban }
 *   contactDelete  { contactId }
 *
 *   cardOrder      { accountId, tier }
 *   cardActivate   { cardId }
 *   cardBlock      { cardId, blocked }
 *   cardRenew      { cardId }
 *   cardAutoRenew  { cardId, enabled }
 *   cardPin        { cardId, pin }
 *   cardLimit      { cardId, limit }
 *   cardDelete     { cardId }
 *
 *   savingsMove    { accountId, amount, direction: 'in' | 'out' }   checking <-> savings
 *   goalCreate     { accountId, name, target }
 *   goalMove       { goalId, amount, direction: 'in' | 'out' }      checking <-> goal
 *   goalDelete     { goalId }
 *
 *   loanApply      { accountId, planId, amount, termDays }
 *   loanPay        { loanId, amount }
 *
 *   billPay        { billId, accountId }
 *   billPayAll     { accountId }
 *   receiptPrint   { kind: 'transaction' | 'bill', id }
 *
 *   accountCreate  { type, name }
 *   accountRename  { accountId, name }
 *   accountDelete  { accountId }
 *   accountIban    { accountId, iban }
 *   memberAdd      { accountId, playerId }
 *   memberRemove   { accountId, memberId }
 *   memberPerms    { accountId, memberId, perms }
 *
 * The UI validates for feedback only. The server must re-check every
 * amount, balance, IBAN, PIN and permission - never trust these payloads.
 * ------------------------------------------------------------------ */

export type AccountType = 'personal' | 'business' | 'shared';
export type CardTier = 'standard' | 'premium' | 'gold';

export interface Perms {
  deposit: boolean;
  withdraw: boolean;
  transfer: boolean;
  loans: boolean;
}

export interface Member {
  id: string;
  name: string;
  role: 'owner' | 'member';
  perms: Perms;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
}

export interface Account {
  id: string;
  type: AccountType;
  name: string;
  iban: string;
  /** Checking balance. */
  balance: number;
  /** Unallocated savings; goals hold the rest. */
  savings: number;
  goals: Goal[];
  /** Closing checking balance for each of the last 7 days, oldest first. */
  history?: number[];
  interestHistory: { date: number; amount: number }[];
  nextInterestAt?: number;
  /** Unix ms. */
  openedAt: number;
  /** The viewing player's relationship to this account. */
  role: 'owner' | 'member';
  perms: Perms;
  /** Shared and business accounts only. */
  members: Member[];
}

export type TxType = 'deposit' | 'withdraw' | 'transfer_in' | 'transfer_out' | 'paycheck' | 'bill' | 'interest' | 'loan' | 'fee';

export interface Transaction {
  id: string;
  accountId: string;
  type: TxType;
  /** Always positive; direction comes from `type`. */
  amount: number;
  label: string;
  counterparty?: string;
  /** Which pot it touched. Defaults to checking. */
  pot?: 'checking' | 'savings';
  /** Unix ms. */
  date: number;
}

export interface Contact {
  id: string;
  name: string;
  iban: string;
}

export interface Card {
  id: string;
  accountId: string;
  tier: CardTier;
  last4: string;
  holder: string;
  /** Unix ms. */
  expiresAt: number;
  status: 'active' | 'blocked' | 'inactive';
  dailyLimit: number;
  spentToday: number;
  autoRenew: boolean;
}

export interface Loan {
  id: string;
  accountId: string;
  planId: string;
  principal: number;
  /** Still owed, interest included. */
  remaining: number;
  /** Total interest %, credit adjustment applied. */
  rate: number;
  termDays: number;
  dailyPayment: number;
  nextDueAt: number;
  status: 'active' | 'grace' | 'late';
  createdAt: number;
}

export interface Bill {
  id: string;
  label: string;
  issuer: string;
  amount: number;
  issuedAt: number;
  status: 'unpaid' | 'paid';
  paidAt?: number;
}

export interface LoanPlan {
  id: string;
  name: string;
  min: number;
  max: number;
  /** Total interest % before the credit-score adjustment. */
  rate: number;
}

export interface CreditBand {
  /** Lowest score in the band. */
  min: number;
  label: string;
  /** Percentage points added to a loan's rate. */
  adjust: number;
}

export interface TierConfig {
  dailyLimit: number;
  fee: number;
  /** Hex colour of the card. */
  cardColor: string;
  /** Picture for the card front: a file in images/ or an https link. '' = none. */
  image: string;
  /** With an image: print nothing over it. */
  hideText: boolean;
}

export interface BankConfig {
  bankName: string;
  /** Intl locale for numbers/dates (from the locale file's meta.intl), e.g. 'de-DE'. */
  locale?: string;
  /** Hex colour, e.g. "#c8f031". */
  accent: string;
  currency: string;
  features: {
    cards: boolean;
    savings: boolean;
    loans: boolean;
    bills: boolean;
    accounts: boolean;
    multiTransfer: boolean;
    contacts: boolean;
    receipts: boolean;
    customIban: boolean;
    customCardLimits: boolean;
  };
  sound: { enabled: boolean; volume: number };
  cards: {
    tiers: Record<CardTier, TierConfig>;
    maxCards: number;
    maxActive: number;
    activationFee: number;
    renewalFee: number;
    /** Days a new or renewed card stays valid. */
    validDays: number;
  };
  /** Weekly interest % per account type. */
  savingsRates: Record<AccountType, number>;
  loans: {
    plans: LoanPlan[];
    terms: number[];
    maxActive: number;
    /** Borrowing limit = total balance x this. */
    balanceMultiplier: number;
    graceHours: number;
    bands: CreditBand[];
  };
  accounts: { maxOwned: number; creationFee: number; ibanFee: number; ibanPrefix: string };
}

export interface BankData {
  config: BankConfig;
  player: { name: string; cash: number };
  accounts: Account[];
  transactions: Transaction[];
  contacts: Contact[];
  cards: Card[];
  loans: Loan[];
  creditScore: number;
  bills: Bill[];
  /** UI strings in the server's language (config/locales/<code>.json -> "ui"). */
  ui?: Record<string, string>;
}

export type Result<D = BankData> = { ok: true; data: D } | { ok: false; error: string };

/** /bankconfig: the editable part of the config (current + config.lua defaults). */
export interface AdminConfig {
  values: Record<string, unknown>;
  defaults: Record<string, unknown>;
  ui?: Record<string, string>;
  accent: string;
}

/** A printed receipt item's details (server/bills.lua -> receiptPrint). */
export interface Receipt {
  title?: string;
  ref?: string;
  amount?: number;
  incoming?: boolean;
  label?: string;
  party?: string;
  at?: number;
  account?: string;
  iban?: string;
  bank?: string;
}

/** What the receipt view needs without any bank data loaded. */
export interface ReceiptView {
  ui?: Record<string, string>;
  intl?: string;
  currency?: string;
  bankName?: string;
  accent?: string;
}

export type NuiMessage =
  | { action: 'open' | 'openAtm' | 'update'; data: BankData }
  | { action: 'openConfig'; config: AdminConfig }
  | { action: 'receipt'; receipt: Receipt; view: ReceiptView }
  | { action: 'close' }
  | { action: 'incoming'; amount: number; from: string };

/** Used for anything the server's config leaves out. Mirrors config.lua. */
export const DEFAULT_CONFIG: BankConfig = {
  bankName: 'LWK Bank',
  accent: '#c8f031',
  currency: 'USD',
  features: {
    cards: true,
    savings: true,
    loans: true,
    bills: true,
    accounts: true,
    multiTransfer: true,
    contacts: true,
    receipts: true,
    customIban: true,
    customCardLimits: true,
  },
  sound: { enabled: true, volume: 0.5 },
  cards: {
    tiers: {
      standard: { dailyLimit: 5_000, fee: 250, cardColor: '#30342f', image: '', hideText: false },
      premium: { dailyLimit: 25_000, fee: 1_500, cardColor: '#23401c', image: '', hideText: false },
      gold: { dailyLimit: 100_000, fee: 7_500, cardColor: '#e2c06a', image: '', hideText: false },
    },
    maxCards: 10,
    maxActive: 3,
    activationFee: 100,
    renewalFee: 500,
    validDays: 90,
  },
  savingsRates: { personal: 0.5, shared: 0.75, business: 1 },
  loans: {
    plans: [
      { id: 'starter', name: 'Starter', min: 1_000, max: 10_000, rate: 12 },
      { id: 'standard', name: 'Standard', min: 10_000, max: 50_000, rate: 10 },
      { id: 'premium', name: 'Premium', min: 50_000, max: 150_000, rate: 8 },
      { id: 'executive', name: 'Executive', min: 150_000, max: 500_000, rate: 6 },
      { id: 'custom', name: 'Custom', min: 500, max: 1_000_000, rate: 14 },
    ],
    terms: [12, 24, 36, 48, 60],
    maxActive: 4,
    balanceMultiplier: 3,
    graceHours: 6,
    bands: [
      { min: 300, label: 'Very Poor', adjust: 3 },
      { min: 500, label: 'Poor', adjust: 2 },
      { min: 580, label: 'Fair', adjust: 1 },
      { min: 670, label: 'Good', adjust: 0 },
      { min: 740, label: 'Very Good', adjust: -1.5 },
      { min: 800, label: 'Excellent', adjust: -3 },
    ],
  },
  accounts: { maxOwned: 5, creationFee: 500, ibanFee: 2_500, ibanPrefix: 'LW' },
};

/* ------------------------------------------------------------------ */

declare global {
  interface Window {
    GetParentResourceName?: () => string;
  }
}

export const isBrowser = !window.GetParentResourceName;

type MockHandler = (event: string, payload: unknown) => Promise<unknown>;
let mockHandler: MockHandler | null = null;
/** Dev only: answer callbacks locally when running outside FiveM. */
export const setMockHandler = (h: MockHandler) => (mockHandler = h);

export async function fetchNui<T>(event: string, payload: unknown = {}): Promise<T> {
  if (isBrowser) {
    if (!mockHandler) throw new Error(`No mock for ${event}`);
    return (await mockHandler(event, payload)) as T;
  }
  const res = await fetch(`https://${window.GetParentResourceName!()}/${event}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

/** Calls a bank callback and normalises network/Lua errors into a Result. */
export async function callBank(event: string, payload: unknown): Promise<Result> {
  try {
    const r = await fetchNui<Result>(event, payload);
    if (!r || typeof r !== 'object' || !('ok' in r)) return { ok: false, error: 'No response from bank' };
    return r.ok ? { ok: true, data: normalize(r.data) } : r;
  } catch {
    return { ok: false, error: 'Bank is unreachable. Try again.' };
  }
}

/* ---------- normalising what Lua sends ---------- */

/** Lua encodes an empty table as `{}`, not `[]`; coerce every list so `.map` never throws. */
const list = <T,>(x: unknown): T[] => (Array.isArray(x) ? x : x && typeof x === 'object' ? (Object.values(x) as T[]) : []);

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Server config wins key by key; arrays are replaced whole. */
function merge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over ?? base) as T;
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(over)) out[k] = merge((base as Record<string, unknown>)[k], over[k]);
  return out as T;
}

const NO_PERMS: Perms = { deposit: false, withdraw: false, transfer: false, loans: false };

export function normalize(d: BankData): BankData {
  const config = merge(DEFAULT_CONFIG, d.config);
  config.loans.plans = list(config.loans.plans);
  config.loans.terms = list(config.loans.terms);
  config.loans.bands = list<CreditBand>(config.loans.bands).sort((a, b) => a.min - b.min);
  return {
    ...d,
    config,
    creditScore: d.creditScore ?? 650,
    accounts: list<Account>(d.accounts).map((a) => ({
      ...a,
      savings: a.savings ?? 0,
      goals: list(a.goals),
      history: a.history && list<number>(a.history),
      interestHistory: list(a.interestHistory),
      members: list<Member>(a.members).map((m) => ({ ...m, perms: { ...NO_PERMS, ...m.perms } })),
      role: a.role ?? 'owner',
      perms: a.role === 'member' ? { ...NO_PERMS, ...a.perms } : { deposit: true, withdraw: true, transfer: true, loans: true },
    })),
    transactions: list(d.transactions),
    contacts: list(d.contacts),
    cards: list(d.cards),
    loans: list(d.loans),
    bills: list(d.bills),
  };
}

export function useNuiMessage(handler: (msg: NuiMessage) => void) {
  const saved = useRef(handler);
  saved.current = handler;
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data && typeof e.data.action === 'string') saved.current(e.data as NuiMessage);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
}
