import { useEffect, useId, useState, type ReactNode } from "react";
import { brand } from "./config";
import fees from "./data/fees.json";
import {
  activity, breakdown, calculate, compare, comparisonNote, defaultScenario, frequencies,
  providerLabel, providerNames, savingsLevers, shopifyBreakEven, type ListedRate, type Provider, type Scenario,
} from "./lib/calc";
import { inputMaximum, readScenario, writeScenario } from "./lib/scenario";
import "./calculator.css";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const roundedCurrency = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});
const sourceFor = (rate: ListedRate) => fees.sources[rate.source as keyof typeof fees.sources];
const counts = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const percentages = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 3 });
const money = (value: number) => (Math.abs(value) >= 1000 ? roundedCurrency : currency).format(value);
const exact = (value: number) => currency.format(value);
const pct = (value: number) => percentages.format(value);
const dataDate = new Intl.DateTimeFormat("en-US", {
  month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
}).format(new Date(fees.sources.stripe.lastVerified));
type NumberKey = { [K in keyof Scenario]: Scenario[K] extends number ? K : never }[keyof Scenario];

function EstimateTag({ hint = "Estimated using the selected activity and published rates." }: { hint?: string }) {
  return <abbr className="pfc-est" title={hint}>est.</abbr>;
}

function Choice<T extends string>({ label, value, options, change }: {
  label: string; value: T; options: readonly (readonly [T, string])[]; change: (value: T) => void;
}) {
  return (
    <div className="pfc-choice" role="group" aria-label={label}>
      {options.map(([key, title]) => (
        <button key={key} type="button" aria-pressed={value === key} onClick={() => change(key)}>{title}</button>
      ))}
    </div>
  );
}

function Select<T extends string>({ label, value, options, change }: {
  label: string; value: T; options: readonly (readonly [T, string])[]; change: (value: T) => void;
}) {
  return <label className="pfc-field">{label}
    <select value={value} onChange={(event) => change(event.target.value as T)}>
      {options.map(([key, title]) => <option key={key} value={key}>{title}</option>)}
    </select>
  </label>;
}

function Check({ label, checked, change }: {
  label: string; checked: boolean; change: (value: boolean) => void;
}) {
  return <label className="pfc-check"><input type="checkbox" checked={checked}
    onChange={(event) => change(event.target.checked)} />{label}</label>;
}

function Details({ title, children }: { title: string; children: ReactNode }) {
  return <details className="pfc-details"><summary>{title}<span aria-hidden="true" /></summary>
    <div className="pfc-details-content">{children}</div>
  </details>;
}

const frequencyOptions = [
  ["weekly", "Weekly"], ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["annual", "Annually"],
] as const;
const shopifyOptions = [["basic", "Basic"], ["grow", "Grow"], ["advanced", "Advanced"]] as const;
const squareOptions = [["free", "Free"], ["plus", "Plus"], ["premium", "Premium"]] as const;
const paypalOptions = [["checkout", "PayPal Checkout"], ["standard", "Standard cards"], ["advanced", "Advanced cards"]] as const;
const providerOptions = Object.entries(providerNames) as [Provider, string][];

function displayRate(rate: ListedRate) {
  if ("amount" in rate) return exact(rate.amount);
  const base = rate.fixed ? pct(rate.pct) + " + " + exact(rate.fixed) : pct(rate.pct);
  return rate.cap ? base + " · " + exact(rate.cap) + " cap" : base;
}

export function Calculator({ syncUrl = false, initialScenario }: {
  syncUrl?: boolean; initialScenario?: Partial<Scenario>;
}) {
  const rootId = useId();
  const [defaults] = useState<Scenario>(() => ({ ...defaultScenario, ...initialScenario }));
  const [scenario, setScenario] = useState<Scenario>(() =>
    syncUrl && typeof window !== "undefined" ? readScenario(window.location.search, defaults) : defaults
  );
  const [period, setPeriod] = useState<"month" | "quarter" | "year">(() => {
    if (!syncUrl || typeof window === "undefined") return "year";
    const saved = new URLSearchParams(window.location.search).get("period");
    return saved === "month" || saved === "quarter" ? saved : "year";
  });
  const [unsure, setUnsure] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const { provider, model, channel } = scenario;
  const book = activity(scenario);
  const comparisons = compare(scenario);
  const current = comparisons.find((entry) => entry.provider === provider) ?? calculate(scenario);
  const split = breakdown(scenario, current);
  const levers = savingsLevers(scenario, current, comparisons);
  const breakEven = shopifyBreakEven(scenario);
  const multi = period === "month" ? 12 : period === "quarter" ? 4 : 1;
  const showSubscriptions = model !== "once";
  const showSales = model !== "subscription";
  const showPos = showSales && channel !== "online";
  const showOnline = showSubscriptions || (showSales && channel !== "pos");
  const rail = provider === "shopify" && scenario.shopifyGateway !== "native" ? scenario.shopifyGateway : provider;
  const hasActivity = book.count > 0;
  const summary = hasActivity ? `${providerLabel(scenario)} estimate: ${money(current.total / multi)} per ${period}.` : "Enter sales activity to calculate your fees.";
  const allRates = new Map<string, ListedRate>();
  for (const rate of [...comparisons.flatMap((entry) => entry.rates), ...split.rates]) allRates.set(rate.title, rate);

  useEffect(() => {
    const timer = window.setTimeout(() => setAnnouncement(summary), 450);
    return () => window.clearTimeout(timer);
  }, [summary]);

  useEffect(() => {
    if (!syncUrl) return;
    const next = new URL(window.location.href);
    const params = writeScenario(scenario, defaults);
    if (period !== "year") params.set("period", period);
    next.search = params.toString();
    if (next.href !== window.location.href) window.history.replaceState(window.history.state, "", next);
  }, [defaults, period, scenario, syncUrl]);

  function update<T extends keyof Scenario>(key: T, value: Scenario[T]) {
    setScenario((previous) => ({ ...previous, [key]: value }));
    setShareUrl("");
    setCopied(false);
  }

  function chooseProvider(next: Provider) {
    setUnsure(false);
    update("provider", next);
  }

  function numeric(key: NumberKey, label: string, unit?: "$" | "%", step = 1, help?: string) {
    return <label className="pfc-field">{label}
      <span className="pfc-input">
        {unit === "$" && <span aria-hidden="true">$</span>}
        <input type="number" inputMode={step === 1 ? "numeric" : "decimal"} min={0}
          max={inputMaximum(key)} value={scenario[key] || ""} placeholder="0" step={step}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber;
            update(key, Number.isFinite(value) ? Math.min(inputMaximum(key), Math.max(0, value)) : 0);
          }} />
        {unit === "%" && <span aria-hidden="true">%</span>}
      </span>
      {help && <small>{help}</small>}
    </label>;
  }

  async function share() {
    const url = new URL(window.location.href);
    url.hash = "";
    setShareUrl(url.href);
    try {
      await navigator.clipboard.writeText(url.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const feeLines = [
    ["Processing", current.processing],
    ["Subscription billing", current.billing],
    ["Shopify third-party gateway fees", current.gatewayFee],
    ["Platform and POS plans", current.platform],
    ["Disputes", current.disputes],
  ] as const;
  function downloadEstimate() {
    const rows = [
      ["Provider", providerLabel(scenario)],
      ["Period", period],
      ["Gross payment volume (USD)", (book.volume / multi).toFixed(2)],
      ["Successful payments", (book.count / multi).toFixed(2)],
      ...feeLines.map(([label, amount]) => [label, (amount / multi).toFixed(2)]),
      ["Total fees (USD)", (current.total / multi).toFixed(2)],
    ];
    const csv = rows.map((row) => row.map((cell) => '"' + cell.replaceAll('"', '""') + '"').join(",")).join("\r\n");
    const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = "orangetower-payment-fees.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  const breakdownLines = [
    ["Issuing banks", split.issuing],
    ["Network assessments", split.assessments],
    ["Processor residual", split.markup],
  ] as const;

  return (
    <div className="pfc">
      <header className="pfc-intro">
        <p className="pfc-kicker">{brand.name}</p>
        <h1>Payment fee calculator</h1>
        <p>Compare the cost of accepting payments for your business.</p>
        <div className="pfc-meta"><span>U.S. merchant rates · USD</span><a href={`#${rootId}-sources`}>Rates and sources</a></div>
      </header>

      <a className="pfc-jump" href={`#${rootId}-estimate`}>View estimate{hasActivity && <strong>{money(current.total / multi)} / {period}</strong>}</a>
      <div className="pfc-layout">
        <div className="pfc-inputs">
          <section aria-labelledby={`${rootId}-channel`}>
            <h2 id={`${rootId}-channel`}>How do you sell?</h2>
            <Choice label="Sales channels" value={channel} options={[
              ["online", "Online"], ["pos", "In person"], ["both", "Both"],
            ]} change={(value) => update("channel", value)} />
            {channel === "both" && showSales && <div className="pfc-split">
              <label className="pfc-range">Share of one-time orders in person
                <input type="range" min={0} max={100} value={scenario.posShare}
                  onChange={(event) => update("posShare", Number(event.target.value))} />
              </label>
              {numeric("posShare", "In person", "%")}
              <small>Online orders make up the remaining {counts.format(100 - scenario.posShare)}%.</small>
            </div>}
          </section>

          <section aria-labelledby={`${rootId}-provider`}>
            <h2 id={`${rootId}-provider`}>Who processes your payments?</h2>
            <Choice label="Payment provider" value={unsure ? "unsure" : provider}
              options={[...providerOptions, ["unsure", "I’m not sure"]]} change={(value) => {
                if (value === "unsure") {
                  update("provider", "stripe");
                  setUnsure(true);
                } else chooseProvider(value);
              }} />
            {unsure && <p className="pfc-hint">Using standard Stripe pricing as a starting point.</p>}
            {provider === "shopify" && <>
              <div className="pfc-fields">
                <Select label="Shopify plan" value={scenario.shopifyPlan} options={shopifyOptions}
                  change={(value) => update("shopifyPlan", value)} />
                <Select label="Shopify plan billing" value={scenario.shopifyAnnual ? "annual" : "monthly"}
                  options={[["monthly", "Monthly"], ["annual", "Yearly"]]} change={(value) => update("shopifyAnnual", value === "annual")} />
                <Select label="Payment gateway" value={scenario.shopifyGateway}
                  options={[["native", "Shopify Payments"], ["stripe", "External Stripe"], ["paypal", "External PayPal"]]}
                  change={(value) => update("shopifyGateway", value)} />
                {showPos && numeric("posProLocations", "POS Pro locations")}
              </div>
              <p className="pfc-hint">For Shopify Plus pricing, <a href="https://www.shopify.com/plus/pricing">contact Shopify</a>.</p>
              {scenario.shopifyGateway !== "native" && <p className="pfc-hint">External rates are a modeled quote. Verify checkout and subscription eligibility in your Shopify account. In-person sales use the external processor's POS rate in this scenario.</p>}
            </>}
            {provider === "square" && <>
              <div className="pfc-fields">
                <Select label="Square plan" value={scenario.squarePlan} options={squareOptions}
                  change={(value) => update("squarePlan", value)} />
                {showOnline && <Select label="Square online product" value={scenario.squareOnline}
                  options={[["online", "Square Online / invoices"], ["api", "Online API"]]}
                  change={(value) => update("squareOnline", value)} />}
                {scenario.squarePlan !== "free" && numeric("squareLocations", "Billed locations", undefined, 1, "Paid plans start at one location.")}
              </div>
              <p className="pfc-hint">Uses Square Support’s plan-specific processing rates. Legacy and negotiated rates may differ.</p>
            </>}
            {rail === "paypal" && showOnline && <div className="pfc-fields">
              <Select label="PayPal online product" value={scenario.paypalProduct} options={paypalOptions}
                change={(value) => update("paypalProduct", value)} />
            </div>}
            {rail === "paypal" && showPos && <p className="pfc-hint">In-person sales use PayPal POS.</p>}
            {rail === "stripe" && <div className="pfc-checks">
              {showSubscriptions && <Check label="Apply Stripe Billing to subscriptions" checked={scenario.stripeBilling}
                change={(value) => update("stripeBilling", value)} />}
              {showPos && <Check label="Use Tap to Pay for Stripe Terminal" checked={scenario.stripeTap}
                change={(value) => update("stripeTap", value)} />}
            </div>}
          </section>

          <section aria-labelledby={`${rootId}-sales`}>
            <h2 id={`${rootId}-sales`}>Your business</h2>
            <Choice label="Revenue model" value={model} options={[
              ["once", "One-time sales"], ["subscription", "Subscriptions"], ["both", "Both"],
            ]} change={(value) => update("model", value)} />
            {showSales && <div className="pfc-fields">
              {numeric("orders", "One-time orders per month")}
              {numeric("ticket", "Average order value", "$", .01)}
            </div>}
            {showSubscriptions && <div className="pfc-sub">
              {model === "both" && <h3>Subscriptions</h3>}
              <Choice label="Subscriber input" value={scenario.subscriberInput}
                options={[["users", "Total users + paid share"], ["direct", "Enter paid subscribers"]]}
                change={(value) => update("subscriberInput", value)} />
              <div className="pfc-fields">
                {scenario.subscriberInput === "users" ? <>
                  {numeric("users", "Total users")}
                  {numeric("payingShare", "Share who pay", "%", .1)}
                </> : numeric("subscribers", "Paying subscribers")}
                {numeric("price", "Price per billing period", "$", .01)}
                <Select label="Billing frequency" value={scenario.frequency} options={frequencyOptions}
                  change={(value) => update("frequency", value)} />
                {numeric("annualShare", "Separate annual plan share", "%", .1)}
                {scenario.annualShare > 0 && numeric("annualPrice", "Separate annual plan price", "$", .01)}
              </div>
              <p className="pfc-hint">{counts.format(book.subscribers)} paying subscribers. Recurring charges use online rates and the same payment mix.</p>
            </div>}
            <p className="pfc-derived">{counts.format(book.count / 12)} payments/mo <span aria-hidden="true">·</span> {money(book.volume / 12)} volume/mo</p>
          </section>

          <Details title="Advanced payment assumptions">
            <div className="pfc-fields">
              {numeric("internationalShare", "International cards", "%", .1)}
              {showOnline && (rail === "stripe" || rail === "shopify") &&
                numeric("conversionShare", "Online card volume converted", "%", .1)}
              {showPos && rail !== "stripe" && numeric("keyedShare", "Manually entered POS cards", "%", .1)}
              {showOnline && rail === "shopify" && numeric("premiumShare", "Premium online cards", "%", .1, "Domestic Amex and commercial cards.")}
              {showSales && channel !== "pos" && rail === "stripe" &&
                numeric("stripeBankShare", "Instant Bank Payments share", "%", .1, "Share of one-time online payments run through Stripe.")}
              {numeric("refundShare", "Refunded sales", "%", .1, "As a share of gross successful charges. Verify your provider’s refund terms.")}
              {numeric("disputes", "Disputes charged per month", undefined, 1, "Count disputes for which your provider retains a fee.")}
              {scenario.customDisputeFee && numeric("disputeFee", "Fee per dispute", "$", .01)}
            </div>
            <div className="pfc-checks">
              <Check label="Use my own fee per dispute across scenarios" checked={scenario.customDisputeFee}
                change={(value) => update("customDisputeFee", value)} />
            </div>
            <p className="pfc-hint">Currency conversion uses published Stripe and Shopify Payments rates for modeled online volume. PayPal and Shopify POS international terms may differ by product or agreement.</p>
          </Details>

          <Details title="Interchange and network assumptions">
            <p className="pfc-hint">These settings affect the domestic card breakdown only. Enter weights for the four card types and the calculator adjusts their shares to sum to 100%.</p>
            <div className="pfc-fields">
              {numeric("regulatedShare", "Regulated debit", "%", .1)}
              {numeric("exemptShare", "Exempt debit", "%", .1)}
              {numeric("consumerShare", "Consumer credit", "%", .1)}
              {numeric("commercialShare", "Commercial credit", "%", .1)}
              {numeric("visaShare", "Visa share of cards", "%", .1, "Mastercard is the remainder.")}
              {numeric("networkPct", "Network assessment", "%", .001)}
              {numeric("regulatedPct", "Regulated debit rate", "%", .001)}
              {numeric("regulatedFixed", "Regulated debit fixed fee", "$", .01)}
            </div>
            {split.totalMix !== 100 && <p className="pfc-hint" role="status">
              {split.totalMix ? "Adjusted shares in the order above" : "All weights are zero. Using the example shares"} · {split.mix.map(pct).join(" / ")}
            </p>}
            <div className="pfc-checks">
              <Check label={`Add eligible fraud-prevention adjustment (${exact(fees.interchange.fraudAdjustment.amount)})`}
                checked={scenario.fraudAdjustment} change={(value) => update("fraudAdjustment", value)} />
            </div>
          </Details>

          <button type="button" className="pfc-text-button" onClick={() => {
            setScenario(defaults);
            setUnsure(false);
            setPeriod("year");
            setShareUrl("");
            setCopied(false);
          }}>Reset example</button>
        </div>

        <div className="pfc-results" id={`${rootId}-estimate`}>
          <section className="pfc-summary" aria-label="Fee estimate">
            <div className="pfc-summary-top">
              <h2>{providerLabel(scenario)}</h2>
              <Choice label="Estimate period" value={period} options={[
                ["month", "Month"], ["quarter", "Quarter"], ["year", "Year"],
              ]} change={(next) => {
                setPeriod(next);
                setShareUrl("");
                setCopied(false);
              }} />
            </div>
            <p className="sr-only" role="status">{announcement}</p>
            {hasActivity ? <>
              <p className="pfc-result-number">{money(current.total / multi)} <EstimateTag /></p>
              <p className="pfc-summary-label">Total fees per {period}</p>
              <div className="pfc-periods">
                <span><strong>{money(current.monthly)}</strong> / mo</span>
                <span><strong>{money(current.quarterly)}</strong> / qtr</span>
                <span><strong>{money(current.total)}</strong> / yr</span>
              </div>
              <dl className="pfc-metrics">
                <div><dt>Effective processing rate</dt><dd>{pct(current.effective)}</dd></div>
                <div><dt>Effective rate, all fees</dt><dd>{pct(current.effectiveAllIn)}</dd></div>
                <div><dt>Average per payment, excluding plans</dt><dd>{exact(current.perPayment)}</dd></div>
              </dl>
              <dl className="pfc-ledger">
                {feeLines.filter(([label, amount]) => label === "Processing" || amount > 0).map(([label, amount]) =>
                  <div key={label}><dt>{label}</dt><dd>{money(amount / multi)}</dd></div>)}
              </dl>
              <p className="pfc-hint">Of processing fees, {money(current.processingFixed / multi)} comes from per-payment charges and {money(current.processingPercent / multi)} from percentage charges.</p>
              {current.keptOnRefunds > 0 && <p className="pfc-hint">{money(current.keptOnRefunds / multi)} of the modeled fees above were estimated to be retained on refunded sales.</p>}
              {showSubscriptions && (frequencies[scenario.frequency] <= 4 || scenario.annualShare > 0) &&
                <p className="pfc-hint">Month and quarter figures are averages. Fees are incurred when customers are charged.</p>}
            </> : <p className="pfc-empty">Enter an order count and value, or an active paid subscription, to see your estimate.</p>}
          </section>

          {hasActivity && <>
            <section className="pfc-result-section" aria-labelledby={`${rootId}-cost`}>
              <h2 id={`${rootId}-cost`}>Where processing fees go <EstimateTag hint="Illustrative mix using selected interchange programs and an editable network assessment." /></h2>
              {current.cardProcessing > 0 ? <>
                <p className="pfc-hint">Illustrative split of domestic card processing fees. Card or wallet products use the Visa and Mastercard mix you enter.</p>
                {split.residual >= 0 && <div className="pfc-bar" aria-hidden="true">
                  {breakdownLines.map(([label, amount]) => <span key={label} style={{ width: pct(amount / current.cardProcessing) }} />)}
                </div>}
                <dl className="pfc-split-ledger">
                  {breakdownLines.map(([label, amount]) => <div key={label}><dt>{label}</dt><dd>{money(amount / multi)}</dd></div>)}
                </dl>
                {split.residual < 0 && <p className="pfc-hint">This card mix implies interchange and assessments above the published flat rate. The residual is shown as $0. The provider estimate still uses its published price.</p>}
              </> : <p className="pfc-hint">This estimate has no domestic card processing volume.</p>}
            </section>

            <section className="pfc-result-section" aria-labelledby={`${rootId}-compare`}>
              <h2 id={`${rootId}-compare`}>Compare providers <EstimateTag /></h2>
              <p className="pfc-hint">Same gross sales, sorted by cost per {period}. Select a provider to change the estimate.</p>
              <div className="pfc-comparison">
                {comparisons.map((entry) => {
                  const delta = (entry.total - current.total) / multi;
                  return <button type="button" key={entry.provider} aria-pressed={entry.provider === provider}
                    onClick={() => chooseProvider(entry.provider)}>
                    <span><strong>{entry.label}</strong><small>{comparisonNote(scenario, entry.provider)}</small></span>
                    <span><strong>{money(entry.total / multi)}</strong>
                      <small>{entry.provider === provider ? "Selected" : Math.abs(delta) < .005 ? "Same cost"
                        : (delta < 0 ? "−" : "+") + money(Math.abs(delta))}</small></span>
                  </button>;
                })}
              </div>
            </section>

            {(levers.length > 0 || breakEven || current.fixedShare > .25) && <section className="pfc-result-section">
              <h2>Ways to lower fees <EstimateTag /></h2>
              {levers.length > 0 && <ul className="pfc-levers">
                {levers.map((lever) => <li key={lever.title}><div>
                  <strong>{lever.title}</strong><p>{lever.detail}</p>
                </div><strong>{money(lever.savings)}/yr</strong></li>)}
              </ul>}
              {breakEven && <p className="pfc-hint">At this same payment mix, Shopify {breakEven.plan} breaks even at {money(breakEven.volume)} in gross sales per month.</p>}
              {current.fixedShare > .25 && <p className="pfc-hint">Per-payment charges are {pct(current.fixedShare)} of total fees. Combining small purchases can reduce the number of fixed charges.</p>}
            </section>}

            <div className="pfc-share">
              <div className="pfc-actions">
                {syncUrl && <button type="button" className="pfc-text-button" onClick={share}>{copied ? "Link copied" : "Share this estimate"}</button>}
                <button type="button" className="pfc-text-button" onClick={downloadEstimate}>Download CSV</button>
              </div>
              {syncUrl && <p className="pfc-hint">The share link contains your scenario inputs.</p>}
              {shareUrl && <label className="pfc-field">Shareable link<input className="pfc-share-url"
                readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} /></label>}
              <span className="sr-only" role="status">{copied ? "Scenario link copied" : ""}</span>
            </div>
          </>}
        </div>
      </div>

      <footer className="pfc-footer">
        <section className="pfc-cta" aria-label="Fee review">
          <h2>{brand.ctaHeadline}</h2>
          <a href={brand.ctaUrl}>{brand.ctaButton}</a>
        </section>

        {brand.showEmailCapture && hasActivity && <form className="pfc-fields pfc-email" onSubmit={(event) => {
          event.preventDefault();
          const subject = encodeURIComponent("Payment fee estimate");
          const body = encodeURIComponent(summary + "\n\n" + window.location.href);
          window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
        }}>
          <label className="pfc-field">Email address<input type="email" value={email}
            onChange={(event) => setEmail(event.target.value)} required /></label>
          <button type="submit" className="pfc-text-button">Open email draft</button>
        </form>}

        <section id={`${rootId}-sources`}>
          <Details title="Sources and methodology">
            <p className="pfc-hint">The table includes the published rates used by the current estimate and comparison. Entered overrides affect the results while these links retain their published benchmarks.</p>
            <ul className="pfc-method-list">
              <li>All amounts use successful gross charges before refunds. The fixed-fee split covers payment processing. Platform plans, gateway fees, billing and disputes appear separately when applicable. Stripe Tap to Pay assumes one authorization per sale.</li>
              <li>Shopify’s third-party charge applies to applicable online orders. POS orders are excluded. Shopify identifies Amex and business cards as premium domestic cards and publishes a separate international online surcharge. <a href={fees.sources.shopifyCards.url}>Card types</a> · <a href={fees.sources.shopifyThirdParty.url}>Gateway fees</a></li>
              <li>Visa examples use Product 1 and Product 2 for consumer and business credit, and CPS/Retail 2 and CPS/Retail for exempt debit. Mastercard uses Merit I and Merit III Base for consumer cards and Data Rate I and II for business credit. Each uses an illustrative base tier. The network assessment is a volume-based assumption, and the processor residual includes any other costs packed into the flat rate.</li>
              <li>PayPal disputes use the published standard dispute fee or a chargeback benchmark depending on the selected product. Verify eligibility and use the override for your actual fee.</li>
            </ul>
            <table className="pfc-rates">
              <caption className="sr-only">Published prices, sources and verification dates</caption>
              <thead><tr><th scope="col">Published benchmark</th><th scope="col">Rate</th></tr></thead>
              <tbody>{[...allRates.values()].map((rate) => <tr key={rate.title}>
                <th scope="row">{rate.title}<small><a href={sourceFor(rate).url}>Source</a> · <time dateTime={sourceFor(rate).lastVerified}>{sourceFor(rate).lastVerified}</time></small></th>
                <td>{displayRate(rate)}</td>
              </tr>)}</tbody>
            </table>
          </Details>
          <Details title="What’s changing in U.S. card fees">
            <ul className="pfc-method-list">
              <li>On June 9, 2026, the court gave preliminary approval to the proposed Visa and Mastercard merchant settlement. The proposal would reduce the combined average effective U.S. credit interchange rate by 10 basis points for five years. The settlement site still described final approval as pending when checked on November 23. <a href={fees.sources.settlement.url}>Settlement updates</a> · <a href={fees.sources.visaSettlement.url}>Visa statement</a></li>
              <li>On October 26, 2026, the Eighth Circuit upheld the district court’s decision vacating the Federal Reserve’s debit interchange fee standard in <i>Corner Post</i>. The court stated that its decision takes effect when its mandate issues. The calculator uses the published schedule as an editable benchmark. <a href={fees.sources.cornerPost.url}>Court opinion</a></li>
              <li>A reduction in interchange can lower a processor’s costs. A merchant on flat-rate pricing only sees a lower fee if its provider changes the price it charges.</li>
            </ul>
          </Details>
          <p className="pfc-disclosure">Published standard U.S. rates checked {dataDate}. Estimates exclude negotiated pricing, taxes, hardware and unmodeled products or charges. Interchange varies by card, merchant category, routing and entry method. This tool provides estimates for informational purposes.</p>
        </section>
      </footer>
    </div>
  );
}
