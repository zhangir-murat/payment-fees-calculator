import fees from "../data/fees.json" with { type: "json" };

type Rate = { pct: number; fixed: number; title: string; source: string; cap?: number };
type Charge = { amount: number; title: string; source: string };
export type ListedRate = Rate | Charge;
export type Provider = "stripe" | "shopify" | "square" | "paypal";
export type Channel = "online" | "pos" | "both";
export const frequencies = { weekly: 52, monthly: 12, quarterly: 4, annual: 1 } as const;

export const defaultScenario = {
  channel: "online" as Channel,
  provider: "stripe" as Provider,
  posShare: 50,
  model: "once" as "once" | "subscription" | "both",
  orders: 1000,
  ticket: 50,
  subscriberInput: "users" as "users" | "direct",
  users: 2000,
  payingShare: 25,
  subscribers: 500,
  price: 20,
  frequency: "monthly" as keyof typeof frequencies,
  annualShare: 0,
  annualPrice: 240,
  stripeBilling: true,
  stripeTap: false,
  stripeBankShare: 0,
  shopifyPlan: "basic" as keyof typeof fees.shopify.plans,
  shopifyAnnual: false,
  shopifyGateway: "native" as "native" | "stripe" | "paypal",
  posProLocations: 0,
  squarePlan: "free" as keyof typeof fees.square.plans,
  squareOnline: "online" as "online" | "api",
  squareLocations: 1,
  paypalProduct: "checkout" as keyof typeof fees.paypal.products,
  internationalShare: 0,
  conversionShare: 0,
  keyedShare: 0,
  premiumShare: 0,
  refundShare: 0,
  disputes: 0,
  customDisputeFee: false,
  disputeFee: 0,
  networkPct: fees.interchange.assessment.pct * 100,
  regulatedPct: fees.interchange.regulated.pct * 100,
  regulatedFixed: fees.interchange.regulated.fixed,
  fraudAdjustment: true,
  visaShare: 65,
  regulatedShare: 35,
  exemptShare: 5,
  consumerShare: 50,
  commercialShare: 10,
};

export type Scenario = typeof defaultScenario;
export type Activity = {
  groups: PaymentGroup[];
  subscribers: number;
  count: number;
  volume: number;
  recurringVolume: number;
};
type PaymentGroup = { channel: "online" | "pos"; recurring: boolean; count: number; ticket: number };

export const percent = (value: number) => Math.min(100, Math.max(0, value)) / 100;
const nonnegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
const volume = (group: PaymentGroup) => group.count * group.ticket;

export function activity(s: Scenario): Activity {
  const groups: PaymentGroup[] = [];
  if (s.model !== "subscription") {
    const inPerson = s.channel === "both" ? percent(s.posShare) : Number(s.channel === "pos");
    const count = nonnegative(s.orders) * 12;
    groups.push(
      { channel: "online", recurring: false, count: count * (1 - inPerson), ticket: nonnegative(s.ticket) },
      { channel: "pos", recurring: false, count: count * inPerson, ticket: nonnegative(s.ticket) },
    );
  }
  const subscribers = s.model === "once" ? 0 : s.subscriberInput === "direct"
    ? nonnegative(s.subscribers) : nonnegative(s.users) * percent(s.payingShare);
  if (subscribers > 0) {
    const annualShare = percent(s.annualShare);
    groups.push(
      { channel: "online", recurring: true, count: subscribers * (1 - annualShare) * frequencies[s.frequency], ticket: nonnegative(s.price) },
      { channel: "online", recurring: true, count: subscribers * annualShare, ticket: nonnegative(s.annualPrice) },
    );
  }
  const charged = groups.filter((group) => group.count > 0 && group.ticket > 0);
  return {
    groups: charged,
    subscribers,
    count: charged.reduce((sum, group) => sum + group.count, 0),
    volume: charged.reduce((sum, group) => sum + volume(group), 0),
    recurringVolume: charged.reduce((sum, group) => sum + (group.recurring ? volume(group) : 0), 0),
  };
}

const providers: Provider[] = ["stripe", "shopify", "square", "paypal"];
export const providerNames = { stripe: "Stripe", shopify: "Shopify", square: "Square", paypal: "PayPal" };
export function providerLabel(s: Scenario, provider = s.provider) {
  if (provider === "shopify") {
    const plan = fees.shopify.plans[s.shopifyPlan].name;
    return "Shopify " + plan;
  }
  return provider === "square" ? "Square " + fees.square.plans[s.squarePlan].name : providerNames[provider];
}

export function comparisonNote(s: Scenario, provider: Provider) {
  const online = s.channel !== "pos" || s.model !== "once";
  if (provider === "stripe") return s.model !== "once" && s.stripeBilling ? "Stripe Billing included" : "Standard payments pricing";
  if (provider === "shopify") {
    const gateway = s.shopifyGateway === "native" ? "Shopify Payments" : providerNames[s.shopifyGateway] + " gateway";
    return gateway + (s.shopifyAnnual ? " · yearly plan billing" : " · monthly plan billing");
  }
  if (provider === "square") return online ? (s.squareOnline === "api" ? "Online API" : "Square Online / invoices") : "Tap, dip or swipe";
  return online ? fees.paypal.products[s.paypalProduct].title.split(" · ")[1] : "PayPal POS";
}

type CardGroup = PaymentGroup & { keyed: boolean };
type Scheme = ReturnType<typeof activity>;
function priced(s: Scenario, data: Scheme, provider: Provider) {
  const rates = new Map<string, ListedRate>();
  const use = (entry: ListedRate) => rates.set(entry.title, entry);
  const shop = fees.shopify.plans[s.shopifyPlan];
  const square = fees.square.plans[s.squarePlan];
  const gateway = provider === "shopify" && s.shopifyGateway !== "native" ? s.shopifyGateway : null;
  const rail = gateway ?? provider;
  let processingFixed = 0, processingPercent = 0, cardProcessing = 0, billing = 0, gatewayFee = 0;
  const domesticCards: CardGroup[] = [];

  for (const group of data.groups) {
    const online = group.channel === "online";
    const stripe = rail === "stripe";
    const shopify = rail === "shopify";
    const squareRail = rail === "square";
    const base = stripe ? (online ? fees.stripe.online : fees.stripe.pos)
      : shopify ? (online ? shop.online : shop.pos)
      : squareRail ? (online ? s.squareOnline === "api" ? fees.square.api : square.online : square.pos)
      : online ? fees.paypal.products[s.paypalProduct] : fees.paypal.pos;

    const bankPayments = stripe && online && !group.recurring ? group.count * percent(s.stripeBankShare) : 0;
    if (bankPayments > 0) {
      use(fees.stripe.bank);
      processingFixed += bankPayments * fees.stripe.bank.fixed;
      processingPercent += bankPayments * group.ticket * fees.stripe.bank.pct;
    }

    const cardCount = group.count - bankPayments;
    // Providers publish different POS adders. PayPal's percentage surcharge here is only for online sales.
    const intl = percent(s.internationalShare);
    const chargeIntl = online || stripe || squareRail ? intl : 0;
    const intlRate = stripe ? fees.stripe.international : shopify ? fees.shopify.international
      : squareRail ? fees.square.international : fees.paypal.international;
    const conversion = online && (stripe || shopify) ? percent(s.conversionShare) : 0;
    const conversionRate = stripe ? fees.stripe.fx : fees.shopify.fx;
    const nativePremium = shopify && online ? percent(s.premiumShare) : 0;
    const keyedRate = online ? null : shopify ? fees.shopify.keyed : squareRail ? fees.square.keyed
      : rail === "paypal" ? fees.paypal.keyed : null;
    const keyed = keyedRate ? percent(s.keyedShare) : 0;
    const ordinary = 1 - keyed - nativePremium;
    const cardPriceGroups = [
      { rate: base, count: cardCount * ordinary, keyed: false },
      { rate: shop.premium, count: cardCount * nativePremium, keyed: false },
      { rate: keyedRate, count: cardCount * keyed, keyed: true },
    ];

    for (const part of cardPriceGroups) {
      if (!part.rate || part.count <= 0) continue;
      const pctCost = part.count * group.ticket * part.rate.pct;
      const tap = stripe && !online && s.stripeTap ? fees.stripe.tap.amount : 0;
      const fixedCost = part.count * (part.rate.fixed + tap);
      use(part.rate);
      if (tap) use(fees.stripe.tap);
      processingPercent += pctCost;
      processingFixed += fixedCost;
      cardProcessing += (pctCost + fixedCost) * (1 - intl);
      if (intl < 1) domesticCards.push({ ...group, count: part.count * (1 - intl), keyed: part.keyed });
    }
    if (cardCount > 0 && chargeIntl > 0) {
      use(intlRate);
      processingPercent += group.ticket * cardCount * chargeIntl * intlRate.pct;
    }
    if (cardCount > 0 && conversion > 0) {
      use(conversionRate);
      processingPercent += group.ticket * cardCount * conversion * conversionRate.pct;
    }
    if (stripe && group.recurring && s.stripeBilling) {
      use(fees.stripe.billing);
      billing += volume(group) * fees.stripe.billing.pct;
    }
    if (gateway && online) {
      use(shop.third);
      gatewayFee += volume(group) * shop.third.pct;
    }
  }

  let platform = 0;
  if (provider === "shopify") {
    const plan = s.shopifyAnnual ? shop.year : shop.month;
    use(plan);
    platform = plan.amount * 12;
    if (s.channel !== "online" && s.model !== "subscription" && s.posProLocations > 0) {
      use(fees.shopify.posPro);
      platform += nonnegative(s.posProLocations) * fees.shopify.posPro.amount * 12;
    }
  }
  if (provider === "square") {
    use(square.plan);
    platform = square.plan.amount * 12 * Math.max(1, nonnegative(s.squareLocations));
  }

  const posOnly = data.groups.length > 0 && data.groups.every((group) => group.channel === "pos");
  const disputeRate = rail === "stripe" ? fees.stripe.dispute : rail === "shopify" ? fees.shopify.dispute
    : rail === "square" ? fees.square.dispute : s.paypalProduct === "advanced" || posOnly ? fees.paypal.chargeback : fees.paypal.dispute;
  if (s.disputes > 0 && !s.customDisputeFee) use(disputeRate);
  const disputes = 12 * nonnegative(s.disputes) * (s.customDisputeFee ? nonnegative(s.disputeFee) : disputeRate.amount);
  const processing = processingFixed + processingPercent;
  const keptOnRefunds = (processing + gatewayFee) * percent(s.refundShare);
  const total = processing + billing + gatewayFee + platform + disputes;
  return {
    provider, label: providerLabel(s, provider), processing, processingFixed, processingPercent, billing, gatewayFee, platform,
    disputes, keptOnRefunds, total, quarterly: total / 4, monthly: total / 12,
    effective: data.volume ? processing / data.volume : 0,
    effectiveAllIn: data.volume ? total / data.volume : 0,
    perPayment: data.count ? (total - platform) / data.count : 0,
    fixedShare: total ? processingFixed / total : 0,
    domesticCards, cardProcessing, rates: [...rates.values()],
  };
}

export function calculate(s: Scenario, provider = s.provider) {
  return priced(s, activity(s), provider);
}

export function compare(s: Scenario) {
  const data = activity(s);
  return providers.map((provider) => priced(s, data, provider))
    .sort((a, b) => a.total - b.total || a.label.localeCompare(b.label));
}

function interchangeOn(ticket: number, rate: Pick<Rate, "pct" | "fixed" | "cap">) {
  return Math.min(rate.cap ?? Infinity, ticket * rate.pct + rate.fixed);
}

export function breakdown(s: Scenario, result: ReturnType<typeof calculate>) {
  const table = fees.interchange;
  const entered = [s.regulatedShare, s.exemptShare, s.consumerShare, s.commercialShare];
  const totalMix = entered.reduce((sum, amount) => sum + nonnegative(amount), 0);
  const mix = totalMix === 0 ? [.35, .05, .50, .10] : entered.map((amount) => nonnegative(amount) / totalMix);
  const visa = percent(s.visaShare);
  const regulated = {
    ...table.regulated,
    pct: percent(s.regulatedPct),
    fixed: nonnegative(s.regulatedFixed) + (s.fraudAdjustment ? table.fraudAdjustment.amount : 0),
  };
  const rates = new Map<string, ListedRate>();
  if (s.fraudAdjustment && mix[0] > 0) rates.set(table.fraudAdjustment.title, table.fraudAdjustment);
  if (mix[0] > 0) rates.set(table.regulated.title, table.regulated);
  let issuing = 0, assessments = 0;
  for (const group of result.domesticCards) {
    const channel = group.keyed ? "online" : group.channel;
    let fee = mix[0] * interchangeOn(group.ticket, regulated);
    for (const [network, fraction] of [[table.visa, visa], [table.mastercard, 1 - visa]] as const) {
      if (fraction === 0) continue;
      const tiers = [network.exempt[channel], network.consumer[channel], network.commercial[channel]];
      tiers.forEach((rate, index) => {
        if (mix[index + 1] === 0) return;
        rates.set(rate.title, rate);
        fee += fraction * mix[index + 1] * interchangeOn(group.ticket, rate);
      });
    }
    issuing += group.count * fee;
    assessments += volume(group) * percent(s.networkPct);
  }
  if (result.domesticCards.length) rates.set(table.assessment.title, table.assessment);
  const residual = result.cardProcessing - issuing - assessments;
  return { issuing, assessments, residual, markup: Math.max(0, residual), rates: [...rates.values()], mix, totalMix };
}

type Lever = { title: string; detail: string; savings: number };
export function savingsLevers(s: Scenario, current = calculate(s), comparison = compare(s)) {
  const levers: Lever[] = [];
  function propose(title: string, detail: string, next: Scenario) {
    const savings = current.total - calculate(next).total;
    if (savings > 50.000001) levers.push({ title, detail, savings });
  }

  const charges = frequencies[s.frequency];
  if (s.model !== "once" && percent(s.annualShare) < 1 && charges > 1) {
    const annual = { ...s, frequency: "annual" as const, price: s.price * charges };
    const annualCost = calculate(annual).total;
    const quarterly = { ...s, frequency: "quarterly" as const, price: s.price * charges / 4 };
    const quarterlyCost = charges > 4 ? calculate(quarterly).total : Infinity;
    if (annualCost <= quarterlyCost) propose("Bill once a year", "Keeps the amount each subscriber pays over a year constant.", annual);
    else propose("Bill quarterly", "Keeps the amount each subscriber pays over a year constant.", quarterly);
  }
  if (s.provider === "shopify") {
    const upgrades = (["grow", "advanced"] as const).filter((plan) => s.shopifyPlan === "basic" || (s.shopifyPlan === "grow" && plan === "advanced"));
    for (const plan of upgrades) {
      propose("Upgrade to Shopify " + fees.shopify.plans[plan].name, "Includes the higher Shopify plan cost.", { ...s, shopifyPlan: plan });
    }
    if (s.shopifyGateway !== "native") {
      propose("Use Shopify Payments", "Includes the change in processing rates and removal of Shopify’s third-party fee.", { ...s, shopifyGateway: "native" });
    }
  }
  if (s.keyedShare > 0) propose("Use tap, dip or swipe for in-person sales", "Assumes the same sales with fewer manually entered payments.", { ...s, keyedShare: 0 });

  const cheapest = comparison.find((estimate) => estimate.provider !== s.provider);
  if (cheapest && current.total - cheapest.total > 50.000001) {
    levers.push({ title: "Switch to " + cheapest.label, detail: "Uses the comparison product for the same sales.", savings: current.total - cheapest.total });
  }
  return levers.sort((a, b) => b.savings - a.savings).slice(0, 3);
}

export function shopifyBreakEven(s: Scenario) {
  if (s.provider !== "shopify" || s.shopifyPlan === "advanced") return null;
  const next = s.shopifyPlan === "basic" ? "grow" : "advanced";
  const data = activity(s);
  if (!data.volume) return null;
  const current = priced(s, data, "shopify");
  const upgraded = priced({ ...s, shopifyPlan: next }, data, "shopify");
  const savingsPerDollar = (current.processing + current.gatewayFee - upgraded.processing - upgraded.gatewayFee) / data.volume;
  return savingsPerDollar > 0.00000001
    ? { plan: fees.shopify.plans[next].name, volume: (upgraded.platform - current.platform) / savingsPerDollar / 12 }
    : null;
}
