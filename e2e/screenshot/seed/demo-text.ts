import type { AppLanguage } from '@kiko/i18n/device-language';

const uk = {
  salary: 'Зарплата',
  accountTopUp: 'Поповнення рахунку',
  groceryStore: 'Сільпо',
  restaurant: 'Пузата Хата',
  utilities: 'Комунальні послуги',
  cinema: 'Планета Кіно',
  gym: 'Спортзал «Sport Life»',
  courier: 'Нова Пошта',
  apartmentRenovation: 'Ремонт квартири',
  mountainVacation: 'Відпустка (Буковель)',
  laptopPurchase: 'Купівля ноутбука',
  carLoanPayment: 'Погашення автокредиту',
  monobank: 'Монобанк',
  vacationJar: 'Банка «Відпустка»',
  jarTopUp: 'Поповнення банки',
  deposit: 'Депозит',
  governmentBonds: 'ОВДП',
  cash: 'Готівка',
  cashWithdrawal: 'Зняття готівки в банкоматі',
  market: 'Ринок',
  discountSupermarket: 'АТБ',
  metro: 'Київський метрополітен',
  privatBank: 'ПриватБанк',
  freelanceProject: 'Фріланс-проєкт',
  bitcoinPurchase: 'Купівля BTC',
  broker: 'Брокер',
  usDollars: 'Долари',
  brokerageTopUp: 'Поповнення брокерського рахунку',
  realEstate: 'Нерухомість',
  apartment: 'Квартира',
  car: 'Автомобіль',
  metals: 'Метали',
  gold: 'Золото',
  debts: 'Борги',
  carLoan: 'Автокредит',
  owedToAndrii: 'Борг Андрію',
};

/**
 * Every user-visible name and label the demo file carries as data (the app's
 * own i18n keys and the seeded category titles are not part of it). The
 * English file is read by an English-speaking App Store reviewer, so it holds
 * no Cyrillic letter; the Ukrainian file keeps the names the marketing
 * screenshots show.
 */
export type DemoText = Record<keyof typeof uk, string>;

const en: DemoText = {
  salary: 'Salary',
  accountTopUp: 'Account top-up',
  groceryStore: 'Silpo',
  restaurant: 'Puzata Hata',
  utilities: 'Utilities',
  cinema: 'Planeta Kino',
  gym: 'Sport Life gym',
  courier: 'Nova Poshta',
  apartmentRenovation: 'Apartment renovation',
  mountainVacation: 'Vacation (Bukovel)',
  laptopPurchase: 'Laptop purchase',
  carLoanPayment: 'Car loan payment',
  monobank: 'Monobank',
  vacationJar: 'Vacation jar',
  jarTopUp: 'Jar top-up',
  deposit: 'Deposit',
  governmentBonds: 'Government bonds (OVDP)',
  cash: 'Cash',
  cashWithdrawal: 'ATM cash withdrawal',
  market: 'Market',
  discountSupermarket: 'ATB',
  metro: 'Kyiv Metro',
  privatBank: 'PrivatBank',
  freelanceProject: 'Freelance project',
  bitcoinPurchase: 'BTC purchase',
  broker: 'Broker',
  usDollars: 'US dollars',
  brokerageTopUp: 'Brokerage account top-up',
  realEstate: 'Real estate',
  apartment: 'Apartment',
  car: 'Car',
  metals: 'Precious metals',
  gold: 'Gold',
  debts: 'Debts',
  carLoan: 'Car loan',
  owedToAndrii: 'Owed to Andrii',
};

export const demoText = { uk, en } satisfies Record<AppLanguage, DemoText>;
