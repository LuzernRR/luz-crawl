# Product Selection and Cross-Market Profit Research

Use this playbook when the user wants product discovery, trend validation, supplier matching, product selection, or estimated marketplace profitability. The goal is to shortlist candidates with traceable evidence, not to label a product a guaranteed bestseller.

## Decision and evidence rules

- Start by stating the decision to support: target country, sales channel, category or customer, budget, fulfillment model, time horizon, and the user's preferred margin/risk. If some are unknown, record assumptions and keep the recommendation provisional.
- Before searching, show a compact plan that names the actual platforms, why each fits, the platform-specific queries, fields to collect, and the order of steps. Select only platforms that answer the decision; never run every connector by default.
- Separate discovery signals from transaction evidence. A rank, ad appearance, views, searches, saves, creator mentions, supplier-card sales text, or estimated orders are not interchangeable with paid orders, net sales, or profit.
- Every captured metric must have a source URL, retrieval time, geography, unit/currency, measurement window, and metric definition. If the source exposes no time window, mark it unknown; never infer “per month” or “recent” from a bare count.
- Keep raw platform output separate from cleaned analysis. Do not silently change, merge, or invent values. Record item identity confidence, field gaps, and whether the source body or only a search card was read.
- Use platform features, extension adapters, official APIs, or otherwise authorized access. Do not bypass access controls. When Edge shows login, CAPTCHA, or verification, leave that route pending and ask the user to complete the page manually; resume the same query after confirmation. Never ask for passwords, verification codes, or cookies.
- Honor the user's explicit browser and automation choice and any applicable saved preference. Reuse its connected extension/session where possible; do not switch browsers or automation surfaces contrary to that choice. Reuse the existing search tab/session where possible and release or close only task-owned temporary tabs when done.

## Platform routing: choose by question

| Question | Good first sources | What the signal means | Common limit |
|---|---|---|---|
| What is selling in a target Amazon category? | Amazon Best Sellers, Movers & Shakers, New Releases; Amazon Product Opportunity Explorer if the seller account has it | Category position; Movers & Shakers are rank gains over a stated recent window; Product Opportunity Explorer exposes seller-facing demand/competition data | Public rank is not unit sales. Capture category, store, rank, date, and whether a list is BSR or rank movement |
| Is a product appearing in paid short-form commerce? | TikTok Creative Center Top Products/Top Ads; TikTok Shop data available to the user; Douyin Compass or authorized data service such as Feigua/Huitun | Advertised-product/creative activity or platform-specific creator/live-commerce metrics | Ads and engagement are not completed organic or net orders; vendor estimates and subscription data need their own provenance |
| Is consumer interest rising? | Google Trends; Bing/Google web search for launches and coverage; platform-native search | Relative search interest and discoverability | Trends is normalized, not absolute demand; web snippets and articles are leads until verified |
| What do consumers like or dislike? | Marketplace reviews/Q&A, Reddit/forums, YouTube, Xiaohongshu, Zhihu, creator comments, support/return clues | Need, objections, failure modes, use cases, language | Samples may be incomplete or biased; distinguish review themes from frequency or population-wide prevalence |
| What is currently strong in a non-Amazon market? | The target marketplace’s own bestseller/trending pages, e.g. Etsy, eBay, Walmart, Mercado Libre, Shopee, Lazada, or a region-appropriate marketplace | Local category or marketplace signal | Use only the marketplace that matches target country, price point, and fulfillment route |
| Can the product be sourced competitively? | 1688, Alibaba, Global Sources, factory sites; then seller contact/sample/quote as authorized | Search-card offer and supplier lead; later a seller-confirmed quote/sample | A visible card price may be a tier price, variant price, or incomplete quote; supplier card sales text may have no visible period |
| Is there product/IP/compliance risk? | Official regulator/import guidance, standards body, patent/trademark databases, platform policy and exact supplier documentation | Requirements or risk evidence for the target country/category | Search results do not determine legal clearance; escalate exact design/material/claims where needed |

Do not use a source merely because a connector exists. For a new product direction, a useful first pass is usually: one target-market sales/trend source, one independent trend or demand source, one consumer-voice source, then supplier matching. Add more only where the evidence disagrees or the decision is high risk. For a user-specified platform, open that platform directly; general search engines are supplementary discovery routes, not substitutes for platform-native data.

## Search plan and keyword learning

For each selected platform, make a short query family from the user's seed:
1. Exact product/category phrase in the platform's own language.
2. Synonyms and local shopper terms.
3. Need/problem and use-case terms.
4. Differentiating attributes: material, size, bundle, mounting, function, audience, season.
5. Adjacent category or format revealed by relevant results.
6. Competitor/product names only as discovery terms; then search generic category terms to avoid overfitting one branded listing.

Use marketplace-specific vocabulary and record each query separately. After the first pass:
- If results are irrelevant, identify the mismatch (market, category, feature, or intent) and tighten the query with observed product attributes.
- If the result set is too small, mine relevant result titles, reviews, categories, and seller terminology for one or two adjacent terms, then search those on the sources where they make sense.
- If a platform blocks the route, mark it as access-limited and switch to another suitable source; do not call it zero demand.
- Preserve successful and weak queries, synonyms, useful result-derived terms, false positives, platform-specific wording, and user corrections in the experience store. Apply explicit user preferences immediately; infer preference changes only after repeated feedback and keep that inference reversible.

## Evidence collection sequence

1. **Define the market and constraint.** Record target country, platform, price band, fulfillment method, budget, product restrictions, acceptable lead time, and target contribution margin. State assumptions when unknown.
2. **Find candidates.** Rank candidates from the chosen demand source. Capture category, list type, rank, price, rating/review count, visible trend window, date, currency, store/region, and product URL. Do not convert rank or search interest into estimated units without a cited, validated model.
3. **Check persistence and breadth.** When possible, compare at least two snapshots or windows (for example 7/30/90 days), a second relevant source, and multiple independent listings/creators. One retrieval is a snapshot, not a trend line. A Movers & Shakers result is a short-window momentum clue; pair it with a baseline category ranking and follow-up retrieval.
4. **Read the product, not just the title.** Capture dimensions, materials, included parts, use case, packaging, variants, price, shipping/fulfillment, and claims from the listing. Compare exact attributes before treating two listings as the same SKU.
5. **Validate the customer problem.** Sample recent positive and low-star reviews, Q&A, returns/complaint themes, and creator comments where accessible. Summarize themes with sample size and date. Do not call a theme common without a count or representative evidence.
6. **Assess competition and differentiation.** Record price distribution, leading brands/listings, review concentration, recent entrants, ad/creator saturation if available, and concrete ways to differentiate. A crowded category may still have room, but “same product at lower price” is not differentiation by itself.
7. **Match suppliers.** Search 1688 or another source with the normalized attributes and exact-use terms. Compare at least two likely suppliers when possible. Capture listing title, seller, offer ID, exact URL, price/range, MOQ, variant, material, dimensions, surface/finish, shipping, badges, sales text, and quote time. Mark every missing field.
8. **Move up the evidence ladder.** Keep stages separate: search card → official listing/variant details → seller-confirmed written quote and requirements → sample/specification inspection → landed-cost and fulfillment validation. Do not treat a card as supplier confirmation or an uninspected sample as proven quality.
9. **Model unit economics and risk.** Use the actual target marketplace fee category and exact fulfillment dimensions/weight when available. Show base, downside, and upside assumptions; unknown costs stay explicit.
10. **Recommend a next action.** Use “candidate for validation”, “needs evidence”, or “reject under stated assumptions”. Only recommend a small test after unit economics, supplier, compliance, and demand checks support it. Never promise virality or guaranteed profit.

## Product identity and data schema

Normalize a candidate before joining cross-platform records. Suggested fields:
- candidate ID, generic product name, target market, sales channel, category/path;
- attributes: function, material/grade, dimensions, color/finish, mounting, included parts, bundle count, power/battery, intended user/use case;
- source listing ID/ASIN/URL, source platform, retrieved timestamp, locale/currency;
- metric name, metric value/unit, metric window, metric semantics, observed/estimated status;
- price type (list, sale, tier, MOQ, shipping included/unknown), review count/rating, rank type/category;
- supplier ID/name/URL, MOQ, lead time, shipping, badges, sales text, seller-confirmed status;
- evidence status per field and product-match confidence.

Match confidence:
- **Exact**: function and all decision-critical specs/pack contents match.
- **Strong analogue**: same core use and most specs match; list differences explicitly.
- **Category analogue**: only category/use overlap; do not use its price as a like-for-like cost.
- **Unmatched**: keep records separate.

A title match alone is never enough to claim an exact product match. A product-family match is useful for idea discovery but must not be used as a precise margin input.

## Trend score and stop gates

Use a transparent, configurable screening score, not a learned truth. Default weights are initial prioritization only and should be recalibrated against the user's own test outcomes:
- target-market demand evidence: 20;
- persistence and cross-source consistency: 15;
- strength of customer problem and review evidence: 10;
- competition/price headroom: 10;
- supplier match, quality evidence, and MOQ/lead-time fit: 15;
- conservative per-unit contribution margin: 20;
- differentiation and content demonstrability: 5;
- compliance, IP, shipping, and returns risk: 5.

Score each dimension with its evidence and confidence (high/medium/low/unknown). Unknown evidence remains unknown and cannot be silently scored as strong. Show both weighted subtotal and coverage, for example “61/100 across 75% of dimensions; supplier quality and landed freight unverified.” Do not let a high total override a stop gate:
- negative downside contribution margin;
- required certification/market access unresolved;
- exact design may infringe a protected right or platform policy;
- material, product claims, or safety data unverified;
- supplier won't confirm the exact variant, price, MOQ, or lead time;
- demand signal is only ads/engagement, a single list snapshot, or an undated cumulative count.

These are screening gates. The skill should explain what evidence would reopen a paused candidate rather than disguising missing evidence as a final “no-go”.

## Contribution-profit model

Use the correct target-market definition of revenue and currency. A practical per-unit contribution estimate is:

net selling price
− discounts/refunds allowance
− marketplace referral/payment fee
− fulfillment pick-pack, delivery, and customer-service fees
− inbound freight, prep, storage, customs, and duty allocated per unit
− supplier price and domestic shipping
− inspection/packaging/labeling
− advertising/affiliate cost per order
− return, defect, and replacement allowance
− FX/payment cost
= estimated contribution before fixed overhead and income tax

Report:
- supplier-price-only remainder as **not profit**;
- break-even ad spend / allowable customer-acquisition cost;
- contribution margin percentage on net selling price;
- base, downside, and upside cases with assumptions;
- fee calculator name/link, marketplace category, package dimensions/weight, and retrieval date;
- taxes, fixed account fees, overhead, and VAT/GST treatment if excluded.

Do not apply a single “typical” fee blindly. Category fees and fulfillment fees vary; estimate or mark unknown until category, price, packed size, weight, shipping lane, and fulfillment method are known. FX conversions are assumptions with timestamp/source. No MOQ=1, free shipping badge, or “one-piece dropshipping” claim proves destination fulfillment or profitable economics.

## Reusable output structure

A saved product-selection dossier should contain:
1. decision and provisional recommendation;
2. search plan (selected platforms, rationale, queries, fields, fallbacks);
3. candidate snapshot and evidence dates;
4. trend and consumer-problem evidence with metric windows;
5. competition and product differentiation;
6. supplier comparison with field gaps and identity confidence;
7. contribution economics with downside/base/upside;
8. compliance/IP/quality/fulfillment gates;
9. next validation actions and what would change the recommendation;
10. source links and raw records in raw/.

Keep the conclusion concise and decision-oriented. State whether data proves a trend, merely suggests momentum, or is a candidate hypothesis.
