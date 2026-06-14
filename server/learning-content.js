// FK Home — Logistics course + Knowledge Base content (Ship 1).
// The server module seeds this on boot via learning.seedCourse() + seedReference().
// Checks: type 'scenario' (judgement or order-card, order HTML lives in the prompt),
// 'mcq', or 'free_text'. Options carry {text, correct, fb, cost} — grading reads `correct`,
// the frontend shows fb/cost.

const ORDER = (o) => `<div class="lms-order"><div class="ob"><span class="dot"></span>Linnworks · Open order · <b>${o.id}</b> · ${o.channel}</div>`+
  `<table><tr><td class="k">Items</td><td class="v">${o.items}</td></tr><tr><td class="k">Dimensions</td><td class="v">${o.dims}</td></tr>`+
  `<tr><td class="k">Weight</td><td class="v">${o.weight}</td></tr><tr><td class="k">Courier</td><td class="v"><span class="sel">${o.courier} ▾</span> (auto)</td></tr>`+
  `<tr><td class="k">Ship to</td><td class="v">${o.shipTo}</td></tr><tr><td class="k">Paid</td><td class="v">${o.paid}</td></tr></table></div>`;

const course = {
  slug: 'logistics-dispatch',
  title: 'Courier Selection & Dispatch',
  department: 'logistics',
  competency_key: 'logistics_ready',
  recert_months: 12,
  sessions: [
    { title: 'Foundations: where Logistics fits', est: 15, tier: 1,
      objective: 'Understand the order journey, your remote role, and why the rules exist.',
      body_html: `<p>This is a <b>desk role in Linnworks</b>. You verify, choose the courier, arrange the pick wave, and fix issues. The <b>warehouse prints labels and packs</b>. If something fails, they message you and you fix it in the system.</p><p>Wrong courier = rejected, surcharged or damaged parcel = money lost and a customer let down.</p>`,
      checks: [
        { type:'scenario', prompt:`Warehouse messages you: "Label for #FK-2231 failed — the Yodel portal rejected it." You're remote. First move?`,
          options:[
            {text:'Tell them to just try printing it again.',correct:false,fb:'A portal rejection is a data/courier problem, not a printer hiccup.',cost:'The order stalls and bounces back to you.'},
            {text:'Open #FK-2231 in Linnworks, find why Yodel rejected it, fix it, then tell them to reprint.',correct:true,fb:'Right — the fix is yours, in the system.'},
            {text:'Walk over to the warehouse to look at their printer.',correct:false,fb:"You're remote, and it isn't a printer fault.",cost:'Pure time lost.'},
            {text:'Cancel and refund the order.',correct:false,fb:'Drastic — the order is fine, the data needs a fix.',cost:'A lost sale for no reason.'}
          ]},
        { type:'scenario', prompt:`An order must go out today. Who assigns it to a pick wave?`,
          options:[
            {text:'The warehouse decides when they pick it.',correct:false,fb:'Pick-wave assignment is yours, in Linnworks.',cost:'Same-day orders slip if nobody assigns them.'},
            {text:'You do, in Linnworks.',correct:true,fb:'Right — you assign the wave; they pick and pack.'}
          ]}
      ]},

    { title: 'Checking size & weight fit the courier', est: 20, tier: 1,
      objective: 'Read the order’s dimensions and weight, verify the courier fits, or decide to split — no measuring.',
      body_html: `<p>Dimensions and weight come from the order in Linnworks. Check them against the courier’s limits.</p><ul><li><b>÷1000 = litres</b> (Amazon/Prime, Yodel, Evri; 40 L)</li><li><b>÷5000 = dimensional</b> (DHL, DX; 25)</li><li>Yodel CBM <b>0.113 m³</b> — verify on the online calculator.</li></ul><p>Limits aren’t only volume — <b>length and weight kill a courier too</b>.</p>`,
      checks: [
        { type:'scenario', prompt: ORDER({id:'#FK-3104',channel:'Amazon',items:'1 × Olympic Barbell 7ft',dims:'220 × 12 × 12 cm',weight:'9.0 kg',courier:'Evri Next Day',shipTo:'14 Mill Road, Cardiff, CF24 1AA',paid:'Next-day — £6.99'}) + '<b>Process #FK-3104.</b>',
          options:[
            {text:'31.7 L (under 40) and 9 kg (under 15) — release on Evri.',correct:false,fb:"You checked volume and weight but it's 220 cm long. Evri's max is 120 cm.",cost:'Evri rejects a 2.2 m parcel — day wasted.'},
            {text:'Over Evri’s length — split into two Evri parcels.',correct:false,fb:"It's one solid barbell — you can't split a single item.",cost:'Impossible instruction to the warehouse.'},
            {text:'Use DX Length service (up to 200 cm).',correct:false,fb:"So close — but it's 220 cm, and DX Length tops out at 200.",cost:'DX Length rejects it — 20 cm over.'},
            {text:'220 cm — too long for Evri (120) and DX Length (200). Use DX Overnight (no size limit).',correct:true,fb:'Correct. Length ruled out everything except DX Overnight.'}
          ]},
        { type:'scenario', prompt:`A Yodel order: the CBM calculator shows <b>0.118 m³</b>. Weight 11 kg, length 70 cm. What do you do?`,
          options:[
            {text:'Weight and length are fine — send it Yodel.',correct:false,fb:'CBM is 0.118, over Yodel’s 0.113.',cost:'Rejected at collection.'},
            {text:'It’s over Yodel’s 0.113 CBM — split it or move courier.',correct:true,fb:'Right — you caught the one figure that’s over.'}
          ]}
      ]},

    { title: 'Standard couriers: Amazon/Prime, Yodel, Evri', est: 25, tier: 2,
      objective: 'Confirm the right standard courier and apply the combining rules.',
      body_html: `<ul><li><b>Amazon/Prime</b> — auto on Prime, don’t normally change. 40 L.</li><li><b>Yodel</b> — 17 kg, 90 cm, 0.113 m³.</li><li><b>Evri</b> — 15 kg, 120 cm, 40 L.</li></ul><p>Combine only when the <b>combined</b> weight, size and volume all pass.</p>`,
      checks: [
        { type:'scenario', prompt: ORDER({id:'#FK-3320',channel:'Shopify',items:'3 × Kettlebell 8 kg',dims:'40 × 30 × 30 cm (combined)',weight:'24.0 kg',courier:'Evri Next Day',shipTo:'6 Park View, Leeds, LS6 2AB',paid:'Standard — £4.99'}) + '<b>Process #FK-3320.</b>',
          options:[
            {text:'36 L combined, under 40 — one Evri parcel.',correct:false,fb:"Volume's fine but it's 24 kg. Evri's limit is 15 kg.",cost:'Evri rejects an over-weight parcel.'},
            {text:'Move it to Yodel — higher limit.',correct:false,fb:"Yodel's limit is 17 kg. 24 kg is over that too.",cost:"You've burned a second courier."},
            {text:'24 kg is over Evri (15) and Yodel (17) — split into parcels each under the weight limit, re-checking each fits.',correct:true,fb:'Correct — weight was the killer, and you re-check each split parcel.'},
            {text:'Three kettlebells = three labels.',correct:false,fb:'Lazy — 8 kg each is fine, but you’d pay for 3 parcels when 2 may do.',cost:'Overspend on postage.'}
          ]},
        { type:'scenario', prompt:`An Amazon Prime order flags "item not eligible for Amazon Shipping." It's 12 kg, 80 cm, 30 L.`,
          options:[
            {text:'Leave it on Amazon and let it retry.',correct:false,fb:"It won't fix itself; ineligible means pick another courier.",cost:'Order sits unprocessed.'},
            {text:'Change to Evri/Yodel/DHL by its size & weight, then regenerate.',correct:true,fb:'Right — choose by the actual numbers.'}
          ]}
      ]},

    { title: 'Big & heavy: DHL, DX, DX Freight', est: 25, tier: 2,
      objective: 'Handle zoned and heavy couriers and special sizes.',
      body_html: `<ul><li><b>DHL</b> — 30 kg; ÷5000 (over 25 → split); zones A–D; <b>9:00/10:30 not available in Zone D</b>.</li><li><b>DX Box</b> 25 kg/150 cm; <b>Length</b> 200 cm.</li><li><b>DX Overnight</b> — treadmills, heavy gym kit; no size/weight limit.</li></ul>`,
      checks: [
        { type:'scenario', prompt: ORDER({id:'#FK-4102',channel:'Shopify',items:'1 × Resistance Rack',dims:'48 × 40 × 36 cm',weight:'19 kg',courier:'DHL Next Working Day',shipTo:'22 Harbour St, Inverness, IV1 1NF',paid:'Next-day BY 9AM — £18.50 paid'}) + '<b>Customer paid DHL next-day by 9am. Process #FK-4102.</b>',
          options:[
            {text:'It fits DHL — generate the 9am label and release.',correct:false,fb:"IV1 (Inverness) is Zone D, and DHL doesn't offer the 9am upgrade in Zone D.",cost:"You charged for a service that can't be delivered."},
            {text:'Hold it. IV1 is Zone D — 9am isn’t available; contact the customer to offer standard next-day and refund the timed premium.',correct:true,fb:'Correct — you caught the zone limit and protected the customer and the money.'},
            {text:'Switch to DX to get the 9am.',correct:false,fb:"You're guessing another courier covers it, and ignoring the customer paid DHL 9am.",cost:'Likely the same Zone-D limitation.'}
          ]},
        { type:'scenario', prompt:`A treadmill, 58 kg, boxed 160 × 80 × 30 cm. Courier?`,
          options:[
            {text:'DX Standard — it’s a box.',correct:false,fb:'DX Standard caps at 25 kg and 150 cm. Over both.',cost:'Rejected.'},
            {text:'DX Overnight — treadmills, no size/weight limit.',correct:true,fb:"Right — that's exactly what DX Overnight is for."},
            {text:'Split across two DHL parcels.',correct:false,fb:"One treadmill, can't be split, and over DHL's 30 kg.",cost:'Impossible instruction.'}
          ]}
      ]},

    { title: 'When labels go wrong', est: 15, tier: 2,
      objective: 'Fix the common courier errors in the system.',
      body_html: `<ul><li>Amazon ineligible → change courier → regenerate.</li><li>Yodel email missing → add info@fksports.co.uk → regenerate.</li><li>Yodel address too long → shorten/abbreviate → regenerate.</li><li>Evri Next Day unavailable → Hermes Tracked → regenerate.</li><li>DHL size fail → recompute ÷5000; over 25 → split.</li></ul>`,
      checks: [
        { type:'scenario', prompt:`A Yodel label fails: "Address or email field too long." The address is a long rural one with full county and country spelled out.`,
          options:[
            {text:'Regenerate again — it might just go through.',correct:false,fb:'The field is genuinely too long; retrying changes nothing.',cost:'Same failure, order stuck.'},
            {text:'Shorten the address — remove wording, use abbreviations — then regenerate.',correct:true,fb:'Right — fix the cause, then regenerate.'},
            {text:'Switch courier to DHL.',correct:false,fb:"Nothing's wrong with Yodel here; you're dodging a 10-second fix.",cost:'Possible cost change for no reason.'}
          ]},
        { type:'scenario', prompt:`Evri reports "Hermes Next Day unavailable for this postcode." Fix?`,
          options:[
            {text:'Change the service to Hermes Tracked, then regenerate.',correct:true,fb:'Right — Tracked is the correct fallback.'},
            {text:'Tell the customer Evri can’t deliver to them.',correct:false,fb:"Tracked is available; you'd lose a deliverable order.",cost:'Cancelled order.'}
          ]}
      ]},

    { title: 'End-of-day verification', est: 15, tier: 2,
      objective: 'Clear every order across all platforms using the pick waves.',
      body_html: `<p>Pick waves: <b>Mixed 14:30</b>, <b>Final Amazon 15:00</b>. Sweep Amazon, eBay, Shopify, Temu, OnBuy. Nothing unprocessed, no same-day pending.</p>`,
      checks: [
        { type:'scenario', prompt:`It's <b>15:08</b>. An Amazon Prime same-day order just dropped. The 15:00 final Amazon wave has gone. What do you do?`,
          options:[
            {text:'Assign it to today’s Amazon wave like normal.',correct:false,fb:"The final Amazon wave (15:00) has passed; there's no later one today.",cost:'It silently misses same-day and breaks the Prime promise.'},
            {text:'Flag it immediately — the final Amazon wave has gone; escalate to get it out or set expectations.',correct:true,fb:'Right — you knew 15:00 was the last wave.'},
            {text:'Leave it for tomorrow’s first wave.',correct:false,fb:'Wrong for a same-day Prime order.',cost:'Late Prime delivery, metrics hit.'}
          ]},
        { type:'scenario', prompt:`At 16:00 you've cleared Amazon, eBay and Shopify and you're about to log off. Done?`,
          options:[
            {text:'Yes — the big channels are clear.',correct:false,fb:"You haven't swept Temu and OnBuy.",cost:'A forgotten-channel order ships late.'},
            {text:'No — sweep Temu and OnBuy too before logging off.',correct:true,fb:'Right — every channel, every day.'}
          ]}
      ]},

    { title: 'Surcharges & getting paid', est: 20, tier: 3,
      objective: 'Handle remote-postcode surcharges and the hard payment rule.',
      body_html: `<p>Remote postcodes carry surcharges. Steps: check postcode → identify courier → surcharge sheet → calculate (surcharge + margin) → <b>written approval</b> → <b>payment before dispatch</b>. Never ship on a promise.</p>`,
      checks: [
        { type:'scenario', prompt: ORDER({id:'#FK-48817',channel:'Shopify',items:'2 × Yoga Mat (rolled)<br>1 × Adjustable Dumbbell Set',dims:'58 × 34 × 34 cm',weight:'14.2 kg',courier:'Evri Next Day',shipTo:'Flat 2, Rothesay Terrace,<br>Isle of Bute, <b>PA20 9LX</b>',paid:'Standard — £4.99'}) + '<b>Process #FK-48817.</b>',
          options:[
            {text:'Split into 2 Evri labels (each under 40 L) and release.',correct:false,fb:'Splitting fixes the 67 L, but PA20 is the Isle of Bute — a remote surcharge postcode, paid only £4.99 standard.',cost:'Surcharge swallowed + likely failed/returned delivery.'},
            {text:'It’s 67 L — change to DHL and release on next day.',correct:false,fb:'DHL to PA20 still carries a remote surcharge that’s unpaid.',cost:'Dispatched before payment to a surcharge zone.'},
            {text:'14.2 kg is under Evri’s 15 kg — release as is.',correct:false,fb:"It's 67 L, over Evri's 40 L, and PA20 is an unpaid surcharge postcode.",cost:'Rejected label + unpaid surcharge.'},
            {text:'Hold it — PA20 (Isle of Bute) is a surcharge postcode: calculate it, get approval and payment first; and 67 L can’t go as one Evri parcel anyway.',correct:true,fb:'Correct — the buried surcharge AND the volume. The one that costs money when missed.'}
          ]},
        { type:'free_text', prompt:'A customer agreed a £15 surcharge by email but hasn’t paid, and is chasing for dispatch. Write exactly what you do and why.',
          model_answer:'Do not dispatch. Written agreement isn’t payment. Take the £15 payment first, confirm it cleared, then release. Payment before dispatch is absolute.',
          pass_criteria:'Must state: do not dispatch until payment is taken (not just approval). Missing payment-before-dispatch = fail.', hard_fail:true }
      ]},

    { title: 'Capstone: clear the queue, signed off', est: 30, tier: 3,
      objective: 'Real orders, several problems, no signposting. Manager watches and signs you off.',
      body_html: `<p>The bar before you’re let loose. Each order may have more than one thing wrong, and nothing flags it. Work them like the real queue.</p>`,
      checks: [
        { type:'scenario', prompt: ORDER({id:'#FK-5001',channel:'Amazon (Prime)',items:'1 × Power Rack (flat-packed)',dims:'200 × 60 × 18 cm',weight:'46 kg',courier:'Amazon Prime',shipTo:'14 Promenade, Douglas, Isle of Man, <b>IM1 2QR</b>',paid:'Prime — standard'}) + '<b>Process #FK-5001. More than one thing is wrong.</b>',
          options:[
            {text:'It’s auto-Prime — leave it and release.',correct:false,fb:'Three problems: 46 kg over every standard courier, 200 cm long, and IM1 (Isle of Man) is a surcharge zone with nothing paid.',cost:'A guaranteed loss.'},
            {text:'Change to DX Overnight and release.',correct:false,fb:'Right courier instinct, but you ignored Isle of Man = surcharge with standard paid.',cost:'Shipped before the surcharge is approved and paid.'},
            {text:'DX Overnight for the size/weight AND hold for the Isle of Man surcharge: calculate, get approval and payment, then release.',correct:true,fb:'Correct — you caught both the courier and the buried surcharge + payment rule.'},
            {text:'Split the rack across two parcels to get under the weight.',correct:false,fb:"One flat-packed item, can't split; and you've still missed the surcharge.",cost:'Impossible instruction + unpaid surcharge.'}
          ]},
        { type:'scenario', prompt:`A 95 cm trampoline, 16 kg. Yodel is cheapest and auto-suggested. A colleague says "just split it into two Yodel parcels."`,
          options:[
            {text:'Split into two Yodel parcels under the weight limit.',correct:false,fb:"One trampoline can't be split, and weight was never the issue.",cost:'Impossible instruction.'},
            {text:'Use Yodel — 16 kg is under 17 kg.',correct:false,fb:"The weight's a distractor. It's 95 cm; over 90 cm is an absolute no for Yodel.",cost:'Rejected on collection.'},
            {text:'Don’t use Yodel — 95 cm is over the 90 cm hard limit and you can’t split one item. Use DX (Length / Overnight).',correct:true,fb:'Correct — you ignored the cheap option and the bad advice.'}
          ]},
        { type:'free_text', prompt:'An order to an EH postcode shows 41 L on Evri, 8 kg, customer paid standard. List everything you’d check before releasing — and whether it can go.',
          model_answer:'41 L is over Evri’s 40 L → can’t go as one Evri parcel; split or change courier. Check the EH postcode isn’t a remote/surcharge area. 8 kg is fine. So: split/re-courier for the volume, confirm no surcharge, then release.',
          pass_criteria:'Spots 41 L is over 40 L (split/re-courier) and mentions checking the postcode for a surcharge.', hard_fail:false }
      ]}
  ]
};

// ---------- Knowledge Base reference items (department-first) ----------
const reference = [
  { department:'logistics', type:'rate_card', title:'Rate cards & limits', verified_on:'2026-06-13',
    config_json:{ couriers:[
      {name:'Amazon/Prime',colour:'#232F3E',limits:'40 L',formula:'÷1000'},
      {name:'Evri',colour:'#0E8A6B',limits:'15 kg · 120 cm · 40 L · ND £3.49 / Tracked £2.99',formula:'÷1000'},
      {name:'Yodel',colour:'#B5176B',limits:'17 kg · 90 cm · 0.113 m³',formula:'÷1000'},
      {name:'DHL',colour:'#D40511',limits:'30 kg · zones A–D',formula:'÷5000'},
      {name:'DX',colour:'#2E86DE',limits:'25 kg · Box 150 cm £6 · Length 200 cm £9.60',formula:'÷5000'},
      {name:'DX Freight',colour:'#16367A',limits:'Heavy / pallet (750 kg max)',formula:'—'}
    ]}},
  { department:'logistics', type:'flashcard', title:'Flashcards', verified_on:'2026-06-13',
    config_json:{ cards:[
      {q:'Evri limits?',a:'15 kg · 120 cm · 40 L'},
      {q:'Yodel limits?',a:'17 kg · 90 cm · 0.113 m³ — never over 90 cm'},
      {q:'DHL "by 9am" — the catch?',a:'Not available in Zone D'},
      {q:'DHL weight limit?',a:'30 kg (the 25 is the volumetric result, not weight)'},
      {q:'DX parcel — Box vs Length service?',a:'Box £6 up to 150 cm · Length £9.60 up to 200 cm'},
      {q:'Treadmill — which courier?',a:'DX Overnight (no size/weight limit)'},
      {q:'Final Amazon pick wave?',a:'15:00 (Mixed wave 14:30)'},
      {q:'Channels to sweep at end of day?',a:'Amazon, eBay, Shopify, Temu, OnBuy'}
    ]}},
  { department:'logistics', type:'error_table', title:'Common errors & fixes', verified_on:'2026-06-13',
    body_html:'<ul><li>Amazon ineligible → change courier → regenerate</li><li>Yodel email missing → add info@fksports.co.uk → regenerate</li><li>Yodel address too long → shorten/abbreviate → regenerate</li><li>Evri Next Day unavailable → Hermes Tracked → regenerate</li><li>DHL size fail → recompute ÷5000; over 25 → split</li></ul>' },
  { department:'logistics', type:'article', title:'End of day', verified_on:'2026-06-13',
    body_html:'<p>Pick waves: Mixed 14:30, Final Amazon 15:00. Sweep Amazon, eBay, Shopify, Temu, OnBuy. Nothing unprocessed, no same-day pending.</p>' },
  { department:'logistics', type:'article', title:'Surcharges & payment', verified_on:'2026-06-13',
    body_html:'<p>Check postcode → identify courier → surcharge sheet → calculate (surcharge + margin) → written approval → <b>payment before dispatch</b>.</p>' },
  { department:'logistics', type:'sop', title:'Full Logistics SOP', verified_on:'2026-06-13',
    body_html:'<p>The complete FK-OPS-SOP-001 — courier selection, errors, end-of-day, surcharges, final checklist. Always the current version.</p>' }
];

module.exports = { course, reference };
