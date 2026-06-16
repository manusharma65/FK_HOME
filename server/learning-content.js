/* FK Home — Learning content: Course A "Despatch Coordinator — Courier & Shipping".
   Built from SOW-WH-003 (the role) and SOP-WH-002 (the pickwave/courier steps).
   Every rule here traces to those documents — do not invent numbers.

   Check shape:
     { type:'scenario', tag?:'label', prompt:'<html>', options:[{text,correct,fb,cost}] }
     { type:'free_text', prompt, model_answer, pass_criteria }
   Aptitude/sanity checks use tag:'Aptitude' — they read the person, not the job knowledge.
*/

// ---- small helpers to keep order-card prompts readable ----
function order(ref, platform, rows, extra) {
  let body = '<div class="lms-order"><div class="ob"><span class="dot"></span>Linnworks · Open order · <b>' + ref + '</b> · ' + platform + '</div><table>';
  rows.forEach(r => { body += '<tr><td class="k">' + r[0] + '</td><td class="v">' + r[1] + '</td></tr>'; });
  body += '</table></div>' + (extra || '');
  return body;
}
const SEL = t => '<span class="sel">' + t + ' \u25be</span>';

const course = {
  slug: 'logistics-dispatch',
  title: 'Despatch Coordinator — Courier & Shipping',
  department: 'logistics',
  competency_key: 'logistics_ready',
  recert_months: 12,
  sessions: [

  // ───────────────────────── SESSION 1 ─────────────────────────
  {
    title: 'The role and the system',
    est: 15, tier: 1,
    objective: 'Understand what a Despatch Coordinator is for, the four platforms, and the line between what you fix yourself and what you escalate.',
    body_html:
      '<p>You are the <b>Despatch Coordinator</b>. You work at a computer, inside <b>Linnworks</b>, across four sales platforms: <b>Amazon, Temu, OneBuy and Shopify</b>. You do not go in the warehouse, you do not weigh, pack or label anything \u2014 the warehouse operative does that. Your job is to read the order data, catch the problems, and make sure the right courier is on every order <b>before</b> the pickwave is released.</p>' +
      '<p>You are the <b>last line of defence before an order reaches the warehouse floor</b>. If you release a wave with a wrong courier or a missed surcharge, the business pays for it \u2014 a rejected parcel, a penalty charge, a delayed customer.</p>' +
      '<h4>How the day runs</h4>' +
      '<p>Orders flow into Linnworks and the system <b>auto-assigns a courier</b> from weight and preset rules. It is right about <b>99%</b> of the time. Your value is the other 1% \u2014 the orders the system gets wrong or can\u2019t decide. You review, fix, then release.</p>' +
      '<h4>What you decide vs what you escalate</h4>' +
      '<p>You act <b>on your own</b> to: reassign a courier (within the rules), split a multi-item order, hold a pickwave until an error is fixed, apply a fixed product rule, remove a customer email on a Temu DHL/Yodel order.</p>' +
      '<p>You <b>escalate</b> (never do it yourself) when: an order is on a platform but missing from Linnworks, a courier outside the SOP is needed, or someone wants a product rule overridden.</p>' +
      '<div class="warn">Measured on accuracy, not speed. A coordinator who rushes and releases wrong waves is failing, however many orders they clear.</div>',
    checks: [
      { type: 'scenario', prompt: 'The Linnworks rule engine auto-assigns the courier on roughly 99% of orders. What does that make <b>your</b> core job each day?',
        options: [
          { text: 'Re-check all 100% of orders from scratch, ignoring the auto-assignment.', correct: false, fb: 'You\u2019d never clear 250 orders a day. The engine is trusted on the 99%.', cost: 'Wave never released \u2014 warehouse sits idle.' },
          { text: 'Find and fix the exceptions \u2014 the orders the system got wrong or couldn\u2019t decide \u2014 then release.', correct: true, fb: 'Right. The engine does the bulk; you own the exceptions and the release.', cost: '' },
          { text: 'Release every wave straight away to keep the warehouse fed.', correct: false, fb: 'That\u2019s how wrong couriers and missed surcharges reach the floor. You verify first.', cost: 'Penalties, rejected parcels, complaints.' }
        ] },
      { type: 'scenario', prompt: 'An order is showing as <b>paid on Amazon</b> but it does <b>not exist in Linnworks</b>. What do you do?',
        options: [
          { text: 'Create the order manually in Linnworks so it can ship.', correct: false, fb: 'Creating or modifying a missing order is above your authority.', cost: 'Unauthorised order, broken data, possible double-ship.' },
          { text: 'Escalate to the supervisor immediately \u2014 do not create or change it.', correct: true, fb: 'Correct. Missing platform orders are an escalation, never a self-fix.', cost: '' },
          { text: 'Cancel it on Amazon so the customer re-orders.', correct: false, fb: 'Not your role \u2014 that\u2019s customer service, and it loses the sale.', cost: 'Lost order, angry customer.' }
        ] },
      { type: 'scenario', prompt: 'A colleague asks you to change the <b>DX contact number</b> (01733 566056) on an order. What\u2019s correct?',
        options: [
          { text: 'Update it \u2014 it\u2019s just a phone number.', correct: false, fb: 'That number is fixed and cannot be changed by this role under any circumstances.', cost: 'Failed DX collections across the board.' },
          { text: 'Leave it \u2014 the DX number is fixed and not yours to change.', correct: true, fb: 'Right. Fixed value, hands off.', cost: '' }
        ] },
      { type: 'scenario', tag: 'Aptitude', prompt: 'You have <b>250 orders</b> and the system gets about <b>99%</b> right. Roughly how many will you need to look at and fix by hand?',
        options: [
          { text: 'About 2\u20133.', correct: true, fb: 'Yes \u2014 1% of 250 is 2.5. A handful, but they\u2019re the ones that cost money.', cost: '' },
          { text: 'About 25.', correct: false, fb: 'That\u2019s 10%. 1% of 250 is about 2\u20133.', cost: '' },
          { text: 'About 125.', correct: false, fb: 'That\u2019s half. 1% of 250 is about 2\u20133.', cost: '' }
        ] },
      { type: 'scenario', tag: 'Aptitude', prompt: 'Read carefully. Which one of these is <b>not</b> like the others? <b>review, verify, check, guess, confirm</b>',
        options: [
          { text: 'guess', correct: true, fb: 'Right \u2014 the others are all deliberate checks. Guessing is the opposite of this job.', cost: '' },
          { text: 'verify', correct: false, fb: 'Verify belongs with review/check/confirm. The odd one is \u201cguess\u201d.', cost: '' },
          { text: 'confirm', correct: false, fb: 'Confirm belongs with the others. The odd one is \u201cguess\u201d.', cost: '' }
        ] }
    ]
  },

  // ───────────────────────── SESSION 2 ─────────────────────────
  {
    title: 'Verify an order before you release',
    est: 20, tier: 1,
    objective: 'Run the five pre-release checks on every order: postcode, weight, length, volume/CBM, and cancelled/duplicate.',
    body_html:
      '<p>Before <b>any</b> pickwave is released, open the order and run five checks. Skip one and a bad order reaches the warehouse.</p>' +
      '<h4>The five checks</h4>' +
      '<ol>' +
      '<li><b>Postcode</b> \u2014 is it on the surcharge list? (BT, IV, HS, ZE and the rest \u2014 full list in the Knowledge Base.) If so, the surcharge must be handled before release.</li>' +
      '<li><b>Gross weight</b> \u2014 within the assigned courier\u2019s limit? Over the limit and the courier rejects it or charges a penalty.</li>' +
      '<li><b>Length</b> \u2014 within the courier\u2019s max length? A parcel can be light and still too long.</li>' +
      '<li><b>Volume / CBM</b> \u2014 for bulky items, weight alone isn\u2019t enough. Use <b>L\u00d7B\u00d7H\u00f71000 = litres</b> (Amazon/Yodel/Evri) or the online CBM for Yodel.</li>' +
      '<li><b>Cancelled / duplicate</b> \u2014 no cancelled order in the wave, no order in twice.</li>' +
      '</ol>' +
      '<div class="warn">Length and weight kill a courier just as fast as volume. Check all three, not just the litres.</div>',
    checks: [
      { type: 'scenario', prompt: order('#FK-3104', 'Amazon',
          [['Items','1 \u00d7 Olympic Barbell 7ft'],['Dimensions','220 \u00d7 12 \u00d7 12 cm'],['Weight','9.0 kg'],['Courier', SEL('Evri Next Day') + ' (auto)'],['Ship to','Cardiff, CF24 1AA'],['Paid','Next-day \u00a36.99']],
          '<b>Process #FK-3104.</b>'),
        options: [
          { text: '31.7 L (under 40) and 9 kg (under 15) \u2014 release on Evri.', correct: false, fb: 'You checked volume and weight but missed length: it\u2019s 220 cm. Evri\u2019s max is 120 cm.', cost: 'Evri rejects a 2.2 m parcel \u2014 day wasted.' },
          { text: 'It\u2019s 220 cm long \u2014 over Evri\u2019s 120 cm limit. Reassign to a courier that takes the length.', correct: true, fb: 'Right. Length killed it before volume ever mattered.', cost: '' },
          { text: 'Split it into two parcels so each is under 120 cm.', correct: false, fb: 'You can\u2019t cut a single 7ft barbell in half. It needs a courier that takes the length.', cost: 'Damaged product, refund.' }
        ] },
      { type: 'scenario', prompt: 'An order\u2019s delivery postcode is <b>IV23 2PJ</b>. The courier and size are all fine. What still has to happen before release?',
        options: [
          { text: 'Nothing \u2014 size and courier are fine, release it.', correct: false, fb: 'IV is a surcharge postcode. A surcharge missed here is billed straight back to the business.', cost: 'Surcharge eaten by FK.' },
          { text: 'Handle the postcode surcharge first \u2014 IV is on the surcharge list.', correct: true, fb: 'Right. Postcode is check #1 for a reason.', cost: '' },
          { text: 'Change the courier to Amazon Prime.', correct: false, fb: 'The courier isn\u2019t the problem \u2014 the un-handled surcharge is.', cost: 'Surcharge still missed.' }
        ] },
      { type: 'scenario', prompt: 'While reviewing a wave you notice the <b>same order appears twice</b>. What do you do?',
        options: [
          { text: 'Release both \u2014 better the customer gets it than not.', correct: false, fb: 'A duplicate ships the order twice. That\u2019s a cancelled-or-duplicate failure.', cost: 'Double shipment, double cost, recovery hassle.' },
          { text: 'Resolve the duplicate before releasing \u2014 one order should ship once.', correct: true, fb: 'Right. Cancelled/duplicate is the fifth check.', cost: '' }
        ] },
      { type: 'scenario', tag: 'Aptitude', prompt: 'A bulky item is <b>40 \u00d7 35 \u00d7 30 cm</b>. Using L\u00d7B\u00d7H\u00f71000, how many litres is that?',
        options: [
          { text: '42 L', correct: true, fb: 'Correct: 40\u00d735\u00d730 = 42,000; \u00f71000 = 42 L. (Over 40, so it can\u2019t go in one box on Amazon/Evri.)', cost: '' },
          { text: '4.2 L', correct: false, fb: 'Out by a factor of ten. 40\u00d735\u00d730 = 42,000; \u00f71000 = 42 L.', cost: '' },
          { text: '105 L', correct: false, fb: 'Recompute: 40\u00d735\u00d730 = 42,000; \u00f71000 = 42 L.', cost: '' }
        ] },
      { type: 'scenario', tag: 'Aptitude', prompt: 'Spot the one that doesn\u2019t belong with the others: <b>BT1, IV3, HS2, LS9, ZE1</b>',
        options: [
          { text: 'LS9', correct: true, fb: 'Right \u2014 BT, IV, HS and ZE are surcharge postcodes; LS (Leeds) is mainland and not on the list. Attention to detail is the whole job.', cost: '' },
          { text: 'ZE1', correct: false, fb: 'ZE (Shetland) is a surcharge postcode. The odd one is LS9.', cost: '' },
          { text: 'BT1', correct: false, fb: 'BT (Northern Ireland) is a surcharge postcode. The odd one is LS9.', cost: '' }
        ] }
    ]
  },

  // ───────────────────────── SESSION 3 ─────────────────────────
  {
    title: 'Courier rules and fit',
    est: 25, tier: 2,
    objective: 'Know each courier\u2019s limits cold and confirm an order fits the one assigned.',
    body_html:
      '<p>Each courier has hard limits. The order has to fit <b>all</b> of them \u2014 weight, length and volume.</p>' +
      '<table class="sop"><tr><th>Courier</th><th>Limits</th><th>Volume</th></tr>' +
      '<tr><td><b>Amazon / Prime</b></td><td>Auto-assigned; don\u2019t change postage normally</td><td>L\u00d7B\u00d7H\u00f71000 &lt; 40 L (one box; over 40 = split)</td></tr>' +
      '<tr><td><b>Yodel</b></td><td>&lt; 17 kg, length \u2264 90 cm</td><td>CBM &lt; 0.113 m\u00b3 (online calculator)</td></tr>' +
      '<tr><td><b>Evri (Hermes)</b></td><td>\u2264 15 kg, \u2264 120 cm</td><td>\u00f71000 &lt; 40 L</td></tr>' +
      '<tr><td><b>DX Standard</b></td><td>\u2264 150 cm, \u2264 25 kg</td><td>\u00f75000; split if &gt; 25</td></tr>' +
      '<tr><td><b>DX Overnight</b></td><td>No size/weight limit \u2014 treadmills, walking pads, big gym kit</td><td>\u2014</td></tr>' +
      '</table>' +
      '<p><b>Amazon restricted items:</b> some products Amazon won\u2019t carry on Prime. Use <b>Run Quotes</b> in Seller Central to see alternatives, and only then reassign.</p>' +
      '<div class="warn">Over 90 cm never goes Yodel \u2014 trampolines, racks, rocking chairs. Length alone rules it out.</div>',
    checks: [
      { type: 'scenario', prompt: order('#FK-3320', 'Shopify',
          [['Items','3 \u00d7 Kettlebell 8 kg'],['Dimensions','40 \u00d7 30 \u00d7 30 cm (combined)'],['Weight','24.0 kg'],['Courier', SEL('Evri Next Day') + ' (auto)'],['Ship to','Leeds, LS1 4DT']],
          '<b>Process #FK-3320.</b>'),
        options: [
          { text: '36 L and 40 cm \u2014 all under Evri\u2019s limits, release.', correct: false, fb: 'Volume and length are fine, but it\u2019s 24 kg \u2014 Evri\u2019s cap is 15 kg.', cost: 'Evri rejects an over-weight parcel.' },
          { text: '24 kg is over Evri\u2019s 15 kg cap \u2014 reassign to a courier that takes the weight (e.g. DX).', correct: true, fb: 'Right. Weight ruled Evri out even though size was fine.', cost: '' },
          { text: 'Leave on Evri but mark it fragile.', correct: false, fb: 'A note doesn\u2019t change the weight limit. It still gets rejected.', cost: 'Rejected at collection.' }
        ] },
      { type: 'scenario', prompt: 'A <b>95 cm trampoline</b>, 16 kg, is auto-suggested on <b>Yodel</b> because it\u2019s the cheapest. Correct move?',
        options: [
          { text: 'Use Yodel \u2014 16 kg is under 17 kg.', correct: false, fb: 'Weight\u2019s fine but it\u2019s 95 cm. Over 90 cm never goes Yodel.', cost: 'Yodel rejects it \u2014 reship on the right courier.' },
          { text: 'Reassign off Yodel \u2014 95 cm is over Yodel\u2019s 90 cm length limit.', correct: true, fb: 'Right. Trampolines/racks/rocking chairs over 90 cm are never Yodel.', cost: '' },
          { text: 'Split it into two Yodel parcels.', correct: false, fb: 'You can\u2019t split one trampoline frame. It needs a courier that takes the length.', cost: 'Damaged goods.' }
        ] },
      { type: 'scenario', prompt: 'An Amazon Prime order flags <b>\u201citem not eligible for Amazon Shipping\u201d</b>. It\u2019s 12 kg, 80 cm, 30 L. What\u2019s the right first step?',
        options: [
          { text: 'Force it through on Prime anyway.', correct: false, fb: 'It\u2019s flagged ineligible \u2014 forcing it just fails the label.', cost: 'Failed label, stuck order.' },
          { text: 'Run Quotes in Seller Central to see eligible alternatives, then reassign to a suitable courier.', correct: true, fb: 'Right \u2014 check alternatives first, then pick a courier the order fits.', cost: '' },
          { text: 'Escalate to the supervisor.', correct: false, fb: 'This one\u2019s within your authority \u2014 Run Quotes and reassign within the SOP.', cost: 'Wasted time, wave delayed.' }
        ] },
      { type: 'scenario', tag: 'Aptitude', prompt: 'A box holds <b>6 sets</b>. You have <b>27 sets</b> to send. How many full boxes, and how many sets left over?',
        options: [
          { text: '4 full boxes, 3 left over.', correct: true, fb: 'Correct: 6\u00d74 = 24, leaving 3. The spare 3 still need a box.', cost: '' },
          { text: '5 full boxes, 0 left over.', correct: false, fb: '5\u00d76 = 30, more than you have. It\u2019s 4 full boxes and 3 over.', cost: '' },
          { text: '4 full boxes, 6 left over.', correct: false, fb: '27 \u2212 24 = 3, not 6. Four boxes and 3 over.', cost: '' }
        ] },
      { type: 'scenario', tag: 'Aptitude', prompt: 'Logic: <b>If a parcel is over 90 cm it cannot go Yodel. This parcel goes Yodel.</b> What must be true?',
        options: [
          { text: 'The parcel is 90 cm or under.', correct: true, fb: 'Right \u2014 if it went Yodel, it can\u2019t be over 90 cm.', cost: '' },
          { text: 'The parcel is over 90 cm.', correct: false, fb: 'Then it couldn\u2019t go Yodel \u2014 contradiction. It must be 90 cm or under.', cost: '' },
          { text: 'Nothing can be known.', correct: false, fb: 'The rule lets you conclude it\u2019s 90 cm or under.', cost: '' }
        ] }
    ]
  },

  // ───────────────────────── SESSION 4 ─────────────────────────
  {
    title: 'The split decision',
    est: 25, tier: 2,
    objective: 'Handle the multi-item orders the engine can\u2019t decide: split across couriers and into packages within each courier\u2019s rules.',
    body_html:
      '<p>This is the core skill. The system can auto-assign a single item easily. It <b>can\u2019t decide</b> when a customer buys several items, or two very different items, in one order. That\u2019s yours.</p>' +
      '<h4>How to think about a mixed order</h4>' +
      '<ul>' +
      '<li>Look at every item. Could they go in one parcel on one courier within its limits? If yes, keep it together.</li>' +
      '<li>If a light item and a heavy/oversized item are on the same order, <b>split the order</b>: send the light item on the cheap courier it fits, and the heavy item on the courier that takes it.</li>' +
      '<li>For the heavy side, <b>split into packages</b> that each fit the courier\u2019s weight and size limits.</li>' +
      '</ul>' +
      '<p><b>Example.</b> One order: a 2.5 kg weight plate and a 90 kg half-rack. The plate ships cheapest on Prime; 90 kg can\u2019t. Split: plate on Prime, rack on DHL, and break the rack into packages under DHL\u2019s 30 kg cap.</p>' +
      '<div class="warn">Splitting is your independent call \u2014 within the volume/weight rules. You don\u2019t need to ask for it. But you must follow the rules when you do it.</div>',
    checks: [
      { type: 'scenario', prompt: order('#FK-5102', 'Shopify',
          [['Items','1 \u00d7 2.5 kg weight plate<br>1 \u00d7 90 kg half-rack'],['Courier', SEL('Amazon Prime') + ' (auto)'],['Ship to','Bristol, BS1 5TR']],
          '<b>Process #FK-5102.</b>'),
        options: [
          { text: 'Leave the whole order on Prime \u2014 it was auto-assigned.', correct: false, fb: '90 kg can\u2019t go Prime. The whole order stalls when the warehouse can\u2019t label it.', cost: 'Order stuck, customer chasing.' },
          { text: 'Move the whole order to DHL.', correct: false, fb: 'The 2.5 kg plate ships far cheaper on Prime \u2014 you\u2019d overpay, and 90 kg still needs splitting under DHL\u2019s 30 kg cap.', cost: 'Overpaid shipping + still over DHL\u2019s limit.' },
          { text: 'Split: plate stays Prime; rack goes DHL, broken into packages under 30 kg each.', correct: true, fb: 'Right \u2014 each item on the courier it fits, heavy side split to the DHL cap.', cost: '' },
          { text: 'Send it to the supervisor to decide.', correct: false, fb: 'Splitting is your independent decision within the rules \u2014 no escalation needed.', cost: 'Wave delayed for no reason.' }
        ] },
      { type: 'scenario', prompt: 'A single order has <b>4 \u00d7 12 kg dumbbells</b> = 48 kg total, going DHL (30 kg cap per package). How do you package it?',
        options: [
          { text: 'One package of 48 kg.', correct: false, fb: 'That\u2019s over DHL\u2019s 30 kg cap. It has to be split into packages each at or under 30 kg.', cost: 'DHL rejects / surcharges the over-weight package.' },
          { text: 'Split into packages each \u2264 30 kg (e.g. 2 + 2 dumbbells = 24 kg each).', correct: true, fb: 'Right \u2014 two packages of 24 kg both sit under the cap.', cost: '' },
          { text: 'Send 3 on DHL and 1 on Prime.', correct: false, fb: 'Same order, same destination \u2014 keep it on one courier and just split the packages under the cap.', cost: 'Two couriers, two costs, confusion.' }
        ] },
      { type: 'scenario', prompt: 'A customer buys a yoga mat (1.2 kg) and a set of adjustable dumbbells (14 kg) in one order, 58 \u00d7 34 \u00d7 34 cm combined. On Evri that volume is 58\u00d734\u00d734\u00f71000 = 67 L. What do you do?',
        options: [
          { text: 'Keep it as one Evri parcel \u2014 weight\u2019s under 15 kg.', correct: false, fb: '67 L is over Evri\u2019s 40 L. It can\u2019t go as one box on Evri.', cost: 'Oversize charge or rejection.' },
          { text: 'It\u2019s 67 L \u2014 over 40 L \u2014 so split into two parcels (or reassign) so each fits.', correct: true, fb: 'Right \u2014 volume forced the split even though weight was fine.', cost: '' },
          { text: 'Escalate \u2014 too complicated.', correct: false, fb: 'A volume split is routine and yours to do.', cost: 'Wave delayed.' }
        ] },
      { type: 'scenario', tag: 'Aptitude', prompt: 'Quick sequence \u2014 what comes next? <b>2, 6, 12, 20, 30, ?</b>',
        options: [
          { text: '42', correct: true, fb: 'Right \u2014 the gaps grow 4, 6, 8, 10, 12. 30 + 12 = 42.', cost: '' },
          { text: '40', correct: false, fb: 'The gaps grow by 2 each time (4,6,8,10,12), so 30 + 12 = 42.', cost: '' },
          { text: '36', correct: false, fb: 'Look at the gaps: 4,6,8,10,12. Next is 30 + 12 = 42.', cost: '' }
        ] },
      { type: 'free_text', prompt: 'In your own words: an order has one light item and one very heavy item. Explain the steps you take and why \u2014 as if telling a new starter.',
        model_answer: 'Identify each item; keep light item on the cheapest courier it fits; put the heavy item on a courier that takes its weight/size; split the heavy item into packages under that courier\u2019s weight cap; assign couriers and release. Reason: each item ships at the right cost and within limits, nothing gets rejected.',
        pass_criteria: 'Mentions splitting the order by item, matching each to a courier it fits, and splitting the heavy item into packages within the cap.' }
    ]
  },

  // ───────────────────────── SESSION 5 ─────────────────────────
  {
    title: 'Special product and EVA mat rules',
    est: 20, tier: 2,
    objective: 'Apply the fixed product rules and the EVA mat set/piece logic without being told.',
    body_html:
      '<p>Some products have <b>fixed rules</b>. They override the auto-assignment and you apply them yourself \u2014 no asking.</p>' +
      '<table class="sop"><tr><th>Product</th><th>Rule</th></tr>' +
      '<tr><td>Vibration plates</td><td>Switch to <b>One Day</b> service (not standard Prime)</td></tr>' +
      '<tr><td>Exercise bikes</td><td>Switch to <b>One Day</b> service</td></tr>' +
      '<tr><td>Stepper (Lily Batch \u2014 Plan21543)</td><td>Change to <b>Hermes Next Day</b></td></tr>' +
      '</table>' +
      '<h4>EVA mats</h4>' +
      '<p><b>1 set = 4 pieces.</b> Box capacity: 60\u00d760 \u2192 6 sets/box; 30\u00d730 \u2192 6 sets/box; 2.5 mm \u2192 3 sets/box.</p>' +
      '<table class="sop"><tr><th>Courier</th><th>Per-order piece limits</th></tr>' +
      '<tr><td>Hermes / Evri</td><td>2.5 \u2192 4 or 8 \u00b7 30\u00d730 \u2192 80 \u00b7 60\u00d760 \u2192 12 \u00b7 12MM \u2192 12 \u00b7 Cartoon \u2192 12</td></tr>' +
      '<tr><td>Yodel</td><td>2.5 \u2192 8 \u00b7 60\u00d760 \u2192 16 \u00b7 12MM \u2192 16 \u00b7 Cartoon \u2192 16</td></tr>' +
      '<tr><td>DHL</td><td>60\u00d760 \u2192 24 (Next Day Large) / 28 (Next Day XL) \u00b7 2.5 (12 pcs) \u2192 One Day Large</td></tr>' +
      '</table>',
    checks: [
      { type: 'scenario', prompt: order('#FK-4410', 'Amazon (Prime)',
          [['Items','1 \u00d7 Vibration Plate'],['Courier', SEL('Amazon Prime (standard)') + ' (auto)'],['Ship to','Manchester, M1 2AB']],
          '<b>Process #FK-4410.</b>'),
        options: [
          { text: 'Leave it on standard Prime \u2014 it\u2019s auto-assigned.', correct: false, fb: 'Vibration plates have a fixed rule: switch to One Day service.', cost: 'Breaks the product rule \u2014 wrong service level.' },
          { text: 'Switch it to One Day service \u2014 the fixed rule for vibration plates.', correct: true, fb: 'Right \u2014 apply the product override yourself.', cost: '' },
          { text: 'Escalate to ask which service to use.', correct: false, fb: 'It\u2019s a fixed rule \u2014 you apply it without asking.', cost: 'Wasted time.' }
        ] },
      { type: 'scenario', prompt: 'An order is for the <b>Stepper, Lily Batch (Plan21543)</b>, auto-assigned to Yodel. What\u2019s correct?',
        options: [
          { text: 'Leave it on Yodel if it fits the limits.', correct: false, fb: 'This SKU has a fixed rule: Hermes Next Day.', cost: 'Wrong courier vs the fixed rule.' },
          { text: 'Change it to Hermes Next Day \u2014 the fixed rule for this batch.', correct: true, fb: 'Right \u2014 the Plan21543 stepper goes Hermes Next Day.', cost: '' }
        ] },
      { type: 'scenario', prompt: 'A customer orders <b>14 pieces of 60\u00d760 EVA mat</b> and wants it on Yodel. Yodel\u2019s 60\u00d760 limit is 16 pcs. Can it go?',
        options: [
          { text: 'No \u2014 14 is over the limit.', correct: false, fb: '14 is under Yodel\u2019s 16-piece cap for 60\u00d760. It fits.', cost: '' },
          { text: 'Yes \u2014 14 is within Yodel\u2019s 16-piece cap for 60\u00d760.', correct: true, fb: 'Right \u2014 reads the table correctly.', cost: '' },
          { text: 'Only if split into two orders.', correct: false, fb: 'No need \u2014 14 is under the 16-piece cap.', cost: 'Unnecessary split.' }
        ] },
      { type: 'scenario', tag: 'Aptitude', prompt: '1 set = 4 pieces. A customer orders <b>5 sets</b> of EVA mat. How many <b>pieces</b> is that?',
        options: [
          { text: '20 pieces.', correct: true, fb: 'Correct: 5 \u00d7 4 = 20.', cost: '' },
          { text: '9 pieces.', correct: false, fb: 'That\u2019s adding, not multiplying. 5 sets \u00d7 4 = 20 pieces.', cost: '' },
          { text: '5 pieces.', correct: false, fb: 'A set is 4 pieces, so 5 sets = 20 pieces.', cost: '' }
        ] },
      { type: 'scenario', tag: 'Aptitude', prompt: 'You\u2019re given five rules to apply and you\u2019ve done four. The fifth contradicts what a colleague tells you verbally. What\u2019s the sound thing to do?',
        options: [
          { text: 'Do what the colleague said \u2014 they\u2019re here now.', correct: false, fb: 'Fixed written rules beat a verbal aside. If it really conflicts, check the SOP / escalate \u2014 don\u2019t just override.', cost: 'Rule broken on hearsay.' },
          { text: 'Follow the written rule; if it genuinely conflicts, check the SOP or escalate rather than override.', correct: true, fb: 'Right \u2014 written rules are the source of truth; escalate genuine conflicts.', cost: '' }
        ] }
    ]
  },

  // ───────────────────────── SESSION 6 ─────────────────────────
  {
    title: 'Surcharge postcodes and the Temu rule',
    est: 20, tier: 2,
    objective: 'Catch every surcharge postcode and apply the Temu email-removal rule before release.',
    body_html:
      '<p>Two things here lose the business real money if missed.</p>' +
      '<h4>Surcharge postcodes</h4>' +
      '<p>Remote areas carry extra shipping charges. If you don\u2019t flag and handle the surcharge, FK pays it. The full list lives in the Knowledge Base \u2014 it includes <b>BT*, IV*, HS*, ZE*, KW*, GY*, IM*, JE*, PA20\u201380*, PH19\u201350*</b> and more. For a parked/surcharge order, check the customer paid the postage \u2014 or route it to a courier we don\u2019t need to charge for (e.g. Hermes).</p>' +
      '<h4>Temu data rule</h4>' +
      '<p>For <b>Temu orders going on DHL or Yodel</b>, <b>remove the customer email address</b> from the order in Linnworks before it progresses. This is a data-handling requirement \u2014 it is mandatory and it is your independent call (no authorisation needed).</p>' +
      '<div class="warn">Temu + DHL/Yodel = strip the email first. Every time.</div>',
    checks: [
      { type: 'scenario', prompt: order('#FK-7781', 'Temu',
          [['Items','1 \u00d7 Resistance Set'],['Weight','6 kg, 40 cm, 20 L'],['Courier', SEL('Yodel') + ' (auto)'],['Ship to','Leeds, LS6 2AA']],
          '<b>Everything fits Yodel. What must you do before release?</b>'),
        options: [
          { text: 'Nothing \u2014 it\u2019s within all limits, release it.', correct: false, fb: 'It\u2019s a Temu order on Yodel \u2014 the customer email must be removed first.', cost: 'Data-handling breach.' },
          { text: 'Remove the customer email from the order in Linnworks, then release.', correct: true, fb: 'Right \u2014 Temu on DHL/Yodel = strip the email.', cost: '' },
          { text: 'Escalate \u2014 Temu orders need supervisor sign-off.', correct: false, fb: 'No \u2014 the email removal is a fixed independent rule.', cost: 'Wasted escalation.' },
          { text: 'Remove the phone number instead.', correct: false, fb: 'It\u2019s the email address, not the phone number.', cost: 'Rule still not applied.' }
        ] },
      { type: 'scenario', prompt: 'A <b>BT (Northern Ireland)</b> order comes through, courier and size fine, and you can see the customer <b>did not pay any postage surcharge</b>. What\u2019s the right action?',
        options: [
          { text: 'Release it on the cheapest courier and absorb the cost.', correct: false, fb: 'That\u2019s the surcharge leak. Either the surcharge is handled, or route to a no-charge courier.', cost: 'FK eats the surcharge.' },
          { text: 'Handle the surcharge \u2014 or route to a courier we don\u2019t need to charge for (e.g. Hermes).', correct: true, fb: 'Right \u2014 that\u2019s exactly the parked-postcode decision.', cost: '' },
          { text: 'Cancel the order.', correct: false, fb: 'Not your call and loses the sale \u2014 handle the surcharge or reroute.', cost: 'Lost order.' }
        ] },
      { type: 'scenario', prompt: 'Which of these postcodes is <b>not</b> a surcharge postcode?',
        options: [
          { text: 'ZE1 (Shetland)', correct: false, fb: 'ZE is on the surcharge list.', cost: '' },
          { text: 'B15 (Birmingham)', correct: true, fb: 'Right \u2014 B (Birmingham) is mainland and not on the list. BT is the surcharge one, not B.', cost: '' },
          { text: 'IM1 (Isle of Man)', correct: false, fb: 'IM is on the surcharge list.', cost: '' }
        ] },
      { type: 'scenario', tag: 'Aptitude', prompt: 'Attention check. How many times does the letter <b>i</b> appear in: <b>\u201cverify dimensions individually\u201d</b>?',
        options: [
          { text: '5', correct: true, fb: 'Right: ver\u0131fy, d\u0131mens\u0131ons, \u0131nd\u0131v\u0131dually \u2014 count them: 5.', cost: '' },
          { text: '4', correct: false, fb: 'Count again carefully \u2014 there are 5 i\u2019s.', cost: '' },
          { text: '6', correct: false, fb: 'Close \u2014 it\u2019s 5.', cost: '' }
        ] }
    ]
  },

  // ───────────────────────── SESSION 7 ─────────────────────────
  {
    title: 'When labels go wrong',
    est: 20, tier: 2,
    objective: 'Fix the real errors that come back from the warehouse, fast and correctly.',
    body_html:
      '<p>The warehouse prints labels from what you set. When something\u2019s wrong, it comes back to you (today on WhatsApp, soon in FK Home chat). These are the real ones.</p>' +
      '<table class="sop"><tr><th>Error</th><th>Fix</th></tr>' +
      '<tr><td>\u201cShipping service not available on Amazon (SWA-UK-PREM)\u201d</td><td>Item ineligible for that Amazon service \u2014 Run Quotes, reassign to a courier it fits.</td></tr>' +
      '<tr><td>\u201cI want 2 labels for this order\u201d</td><td>Order needs splitting into two packages \u2014 split it and generate both labels.</td></tr>' +
      '<tr><td>\u201cEmails / Product Identifier required\u201d</td><td>Missing required field on the order \u2014 add the missing detail so the label can generate.</td></tr>' +
      '<tr><td>Yodel \u201caddress or email field too long\u201d</td><td>Shorten the address (drop spelled-out county/country); add info@fksports.co.uk if email missing.</td></tr>' +
      '<tr><td>\u201cEvri / Hermes Next Day unavailable for this postcode\u201d</td><td>Switch to Hermes Tracked (or a courier that serves it).</td></tr>' +
      '</table>',
    checks: [
      { type: 'scenario', prompt: 'The warehouse sends: <b>\u201cOrder #219576 \u2014 the shipping service you are trying to use is not available on Amazon. Service: SWA-UK-PREM.\u201d</b> What\u2019s the fix?',
        options: [
          { text: 'Tell them to try printing again.', correct: false, fb: 'It\u2019ll fail again \u2014 the item is ineligible for that Amazon service.', cost: 'Order stays stuck.' },
          { text: 'Run Quotes to find an eligible option, then reassign the order to a courier it fits.', correct: true, fb: 'Right \u2014 ineligible service means reassign after checking alternatives.', cost: '' },
          { text: 'Escalate to the supervisor.', correct: false, fb: 'This is within your authority \u2014 reassign within the SOP.', cost: 'Wave delayed.' }
        ] },
      { type: 'scenario', prompt: 'The warehouse messages a photo of an order: <b>\u201cI want 2 labels for this order, please.\u201d</b> What does that usually mean you need to do?',
        options: [
          { text: 'Print the same label twice.', correct: false, fb: 'Two copies of one label won\u2019t help \u2014 the order needs splitting into two packages.', cost: 'Wrong labels, re-do.' },
          { text: 'Split the order into two packages within courier rules, then generate both labels.', correct: true, fb: 'Right \u2014 \u201c2 labels\u201d means two packages.', cost: '' }
        ] },
      { type: 'scenario', prompt: 'A label fails with <b>\u201cemails is required / Product Identifier required\u201d</b>. What do you do?',
        options: [
          { text: 'Ignore it and release the rest of the wave.', correct: false, fb: 'That order never ships. Add the missing field so the label can generate.', cost: 'Order left behind.' },
          { text: 'Add the missing detail (email / product identifier) on the order so the label generates.', correct: true, fb: 'Right \u2014 fill the required field.', cost: '' },
          { text: 'Delete the order.', correct: false, fb: 'Never \u2014 fix the missing field.', cost: 'Lost order.' }
        ] },
      { type: 'scenario', prompt: 'Yodel rejects a label: <b>\u201caddress or email field too long.\u201d</b> The address spells out \u201cWest Yorkshire, United Kingdom\u201d in full. Fix?',
        options: [
          { text: 'Leave it \u2014 Yodel will accept it eventually.', correct: false, fb: 'It won\u2019t \u2014 the field is over length. Shorten it.', cost: 'Label never prints.' },
          { text: 'Shorten the address (drop the spelled-out county/country); add info@fksports.co.uk if the email is missing.', correct: true, fb: 'Right \u2014 trim to fit, supply the fallback email.', cost: '' }
        ] },
      { type: 'scenario', tag: 'Aptitude', prompt: 'Five errors land at once and only some can be fixed before the next pickwave. What\u2019s the most sensible first move?',
        options: [
          { text: 'Fix them in the order they arrived, no matter what.', correct: false, fb: 'Order of arrival isn\u2019t priority. Triage by what blocks the imminent wave.', cost: 'Wrong things fixed first.' },
          { text: 'Triage: fix the ones blocking the next pickwave first, then the rest.', correct: true, fb: 'Right \u2014 prioritise by impact and deadline.', cost: '' },
          { text: 'Wait until you have time to do all five together.', correct: false, fb: 'The wave won\u2019t wait. Handle the blockers now.', cost: 'Missed wave.' }
        ] }
    ]
  },

  // ───────────────────────── SESSION 8 ─────────────────────────
  {
    title: 'Release, log and clear the day',
    est: 20, tier: 3,
    objective: 'Run the back half of the day: baskets, pickwave release, Monday.com logging, watching the clocks, reconciling all four platforms, and the end-of-day report.',
    body_html:
      '<p>Once shippings are fixed, you put orders into <b>baskets</b> (e.g. Prime \u2192 basket 1), then <b>generate a pickwave</b>. Releasing a pickwave is <b>your sign-off</b> that every order in it is clean and ready \u2014 don\u2019t release with any check outstanding.</p>' +
      '<h4>Logging on Monday.com</h4>' +
      '<p>Each pickwave is logged on the warehouse board: Pickwave ID, how many orders, how many boxes, the courier, the picker, and the status. Keep it accurate \u2014 it\u2019s how the warehouse and you stay in step.</p>' +
      '<h4>Watching the clocks</h4>' +
      '<p>Warehouse pickers start and stop a timer per pickwave. Keep an eye on it \u2014 nobody should forget to start or stop a clock.</p>' +
      '<h4>End of day</h4>' +
      '<p>Reconcile <b>all four platforms</b> (Amazon, Temu, OneBuy, Shopify) against Linnworks \u2014 every order present and gone, every courier collected, nothing left to ship. Then generate the report and file the day. If a platform order is missing from Linnworks, <b>escalate \u2014 don\u2019t create it</b>.</p>',
    checks: [
      { type: 'scenario', prompt: 'You\u2019re about to release a pickwave but one order still has an <b>unresolved surcharge</b>. What do you do?',
        options: [
          { text: 'Release the wave \u2014 fix that one order afterwards.', correct: false, fb: 'A released wave is your sign-off it\u2019s clean. You don\u2019t release with a check outstanding.', cost: 'Surcharge ships unhandled.' },
          { text: 'Hold the release until the surcharge is handled.', correct: true, fb: 'Right \u2014 delaying release for an unresolved error is your call and the correct one.', cost: '' }
        ] },
      { type: 'scenario', prompt: 'It\u2019s end of day. You\u2019ve cleared Amazon, eBay and Shopify and you\u2019re about to log off. Is the day done?',
        options: [
          { text: 'Yes \u2014 those are the main platforms.', correct: false, fb: 'You haven\u2019t checked Temu and OneBuy. All four platforms must be clear.', cost: 'Orders left unshipped overnight.' },
          { text: 'No \u2014 reconcile all four (Amazon, Temu, OneBuy, Shopify); nothing left, every courier collected, then report.', correct: true, fb: 'Right \u2014 every platform, every courier, then file.', cost: '' }
        ] },
      { type: 'scenario', prompt: 'You\u2019re logging a pickwave on Monday.com. Which set of details belongs on the row?',
        options: [
          { text: 'Just the courier name.', correct: false, fb: 'Too little \u2014 the board needs the full picture.', cost: 'Warehouse can\u2019t track the wave.' },
          { text: 'Pickwave ID, number of orders, number of boxes, courier, picker, status.', correct: true, fb: 'Right \u2014 that\u2019s the row.', cost: '' },
          { text: 'The customer names and addresses.', correct: false, fb: 'That\u2019s order-level detail, not what the board tracks.', cost: '' }
        ] },
      { type: 'scenario', prompt: 'A picker has been on a pickwave for 55 minutes and the clock is <b>still running</b> though the basket looks done. What\u2019s the sensible action?',
        options: [
          { text: 'Ignore it \u2014 not your job to watch clocks.', correct: false, fb: 'Watching the start/stop clocks is part of your role.', cost: 'Inflated picking times, bad data.' },
          { text: 'Check whether they forgot to stop the clock and prompt them.', correct: true, fb: 'Right \u2014 keep the clocks honest.', cost: '' }
        ] },
      { type: 'scenario', tag: 'Aptitude', prompt: 'A wave has <b>87 orders</b> across <b>3 baskets</b>, split as 40, 30 and 17. Do the basket numbers add up to the order count?',
        options: [
          { text: 'Yes \u2014 40 + 30 + 17 = 87.', correct: true, fb: 'Correct \u2014 they reconcile. Always sanity-check totals before you log them.', cost: '' },
          { text: 'No \u2014 they come to 90.', correct: false, fb: '40 + 30 + 17 = 87, which matches.', cost: '' },
          { text: 'No \u2014 they come to 84.', correct: false, fb: '40 + 30 + 17 = 87, which matches.', cost: '' }
        ] }
    ]
  },

  // ───────────────────────── SESSION 9 (CAPSTONE) ─────────────────────────
  {
    title: 'Capstone: clear the queue',
    est: 25, tier: 3,
    objective: 'Real orders with buried problems, no signposting. Get them right; your manager signs you off.',
    body_html:
      '<p>No hints now. Each order below is the kind you\u2019ll see every day. Read everything \u2014 the trap is rarely the first number you look at.</p>',
    checks: [
      { type: 'scenario', prompt: order('#FK-5001', 'Amazon (Prime)',
          [['Items','1 \u00d7 Power Rack (flat-packed)'],['Dimensions','200 \u00d7 60 \u00d7 18 cm'],['Weight','46 kg'],['Courier', SEL('Amazon Prime') + ' (auto)'],['Ship to','Glasgow, G1 1XQ']],
          '<b>Process #FK-5001.</b>'),
        options: [
          { text: 'Release on Prime \u2014 it\u2019s flat-packed and auto-assigned.', correct: false, fb: '46 kg and 200 cm \u2014 nowhere near Prime. Reassign to a heavy courier and split to the weight cap.', cost: 'Rejected at the warehouse.' },
          { text: 'Reassign to a heavy courier (DHL/DX) and split into packages within the weight cap.', correct: true, fb: 'Right \u2014 weight and length both rule Prime out.', cost: '' },
          { text: 'Split it across Prime and Yodel.', correct: false, fb: 'Neither takes 46 kg / 200 cm. It needs a heavy courier.', cost: 'Both reject.' }
        ] },
      { type: 'scenario', prompt: order('#FK-5002', 'Temu',
          [['Items','2 \u00d7 Yoga Block'],['Weight','1.2 kg, 30 cm, 6 L'],['Courier', SEL('DHL') + ' (auto)'],['Ship to','Cardiff, CF10 1AA']],
          '<b>Process #FK-5002. (Look at the platform.)</b>'),
        options: [
          { text: 'Release \u2014 tiny and well within DHL limits.', correct: false, fb: 'It\u2019s a Temu order on DHL \u2014 remove the customer email first.', cost: 'Data-handling breach.' },
          { text: 'Remove the customer email (Temu on DHL), then release.', correct: true, fb: 'Right \u2014 the platform was the trap, not the size.', cost: '' },
          { text: 'Reassign to Yodel because it\u2019s small.', correct: false, fb: 'No need to reassign \u2014 the issue is the Temu email rule.', cost: 'Pointless change, email still on.' }
        ] },
      { type: 'scenario', prompt: order('#FK-5003', 'Shopify',
          [['Items','1 \u00d7 Kettlebell 10 kg'],['Weight','10 kg, 25 cm'],['Courier', SEL('Yodel') + ' (auto)'],['Ship to','Stornoway, HS1 2AB']],
          '<b>Process #FK-5003. (Everything about the parcel is fine.)</b>'),
        options: [
          { text: 'Release \u2014 10 kg, 25 cm, all within Yodel.', correct: false, fb: 'The parcel\u2019s fine, but HS1 is a surcharge postcode. Handle the surcharge or reroute.', cost: 'FK eats the Highlands & Islands surcharge.' },
          { text: 'HS is a surcharge postcode \u2014 handle the surcharge or route to a no-charge courier before release.', correct: true, fb: 'Right \u2014 the postcode was the trap.', cost: '' },
          { text: 'Split the kettlebell into two parcels.', correct: false, fb: 'A 10 kg single item doesn\u2019t need splitting. The issue is the postcode.', cost: 'Pointless split.' }
        ] },
      { type: 'scenario', prompt: 'During end-of-day reconciliation, an order is <b>paid on OneBuy</b> but <b>absent from Linnworks</b>. Last action of the day. What do you do?',
        options: [
          { text: 'Create it in Linnworks quickly so it\u2019s not left behind.', correct: false, fb: 'Creating a missing order is above your authority \u2014 escalate it.', cost: 'Unauthorised order, data risk.' },
          { text: 'Escalate to the supervisor immediately and don\u2019t modify or create it.', correct: true, fb: 'Right \u2014 missing platform order is always an escalation.', cost: '' },
          { text: 'Leave it \u2014 it\u2019ll sync overnight.', correct: false, fb: 'It might not, and the customer\u2019s waiting. Escalate so it\u2019s actioned.', cost: 'Missed dispatch.' }
        ] },
      { type: 'free_text', prompt: 'An order to an <b>EH (Edinburgh)</b> postcode shows 41 L on Evri, 8 kg, and the customer paid standard postage. List everything you\u2019d check before releasing, and whether it can go as-is.',
        model_answer: 'EH (Edinburgh) is mainland \u2014 not a surcharge postcode, so no surcharge issue. But 41 L is over Evri\u2019s 40 L volume limit, so it cannot go as one Evri parcel \u2014 split into two parcels (or reassign) so each is within 40 L. Weight 8 kg is fine. Confirm length within 120 cm too. So: not as-is \u2014 split for volume, then release.',
        pass_criteria: 'Identifies EH is NOT a surcharge postcode, AND that 41 L exceeds Evri\u2019s 40 L so it must be split/reassigned; concludes it cannot go as-is.' }
    ]
  }

  ]
};

// ───────────────────────── KNOWLEDGE BASE ─────────────────────────
const reference = [
  {
    department: 'logistics', type: 'rate_card', title: 'Courier rate card & limits', verified_on: '2026-06-01',
    config_json: { summary: 'Every courier, its limits and the volume formula \u2014 the one-look reference.',
      couriers: [
        { name: 'Amazon / Prime', colour: '#2DBE73', limits: 'Auto-assigned; don\u2019t change postage', formula: '\u00f71000 < 40 L (one box)' },
        { name: 'Yodel', colour: '#8E44AD', limits: '< 17 kg, \u2264 90 cm', formula: 'CBM < 0.113 m\u00b3' },
        { name: 'Evri (Hermes)', colour: '#C0392B', limits: '\u2264 15 kg, \u2264 120 cm', formula: '\u00f71000 < 40 L' },
        { name: 'DX Standard', colour: '#2D7DD2', limits: '\u2264 150 cm, \u2264 25 kg', formula: '\u00f75000; split > 25' },
        { name: 'DX Overnight', colour: '#1F2A37', limits: 'No size/weight limit \u2014 heavy gym kit', formula: '\u2014' },
        { name: 'DHL', colour: '#C9A227', limits: '\u2264 30 kg (dead or volumetric)', formula: '\u00f75000; split > 30' }
      ] }
  },
  {
    department: 'logistics', type: 'sop', title: 'Surcharge postcodes \u2014 full list', verified_on: '2026-06-01',
    config_json: { summary: 'Every postcode that carries an extra charge \u2014 check before you release.' },
    body_html: '<p>If a delivery postcode matches any of these, it carries an <b>extra shipping charge</b>. Check the customer paid the postage, or route to a courier we don\u2019t need to charge for (e.g. Hermes), before releasing.</p>' +
      '<table class="sop"><tr><th>Postcode pattern</th><th>Area</th></tr>' +
      '<tr><td>BT*</td><td>Northern Ireland</td></tr>' +
      '<tr><td>AB31\u2013AB56*</td><td>Aberdeen (rural)</td></tr>' +
      '<tr><td>EX39 2LY</td><td>Lundy Island</td></tr>' +
      '<tr><td>FK17\u2013FK21*</td><td>Stirling (rural)</td></tr>' +
      '<tr><td>GY*</td><td>Guernsey</td></tr>' +
      '<tr><td>HS*</td><td>Outer Hebrides</td></tr>' +
      '<tr><td>IM*</td><td>Isle of Man</td></tr>' +
      '<tr><td>IV*</td><td>Inverness / Highlands</td></tr>' +
      '<tr><td>JE*</td><td>Jersey</td></tr>' +
      '<tr><td>KA27\u2013KA28*</td><td>Isle of Arran</td></tr>' +
      '<tr><td>KW*</td><td>Orkney / Caithness</td></tr>' +
      '<tr><td>PA20\u2013PA80*</td><td>Argyll islands</td></tr>' +
      '<tr><td>PH19\u2013PH50*</td><td>Highlands</td></tr>' +
      '<tr><td>PO30\u2013PO41*</td><td>Isle of Wight</td></tr>' +
      '<tr><td>TR21\u2013TR25*</td><td>Isles of Scilly</td></tr>' +
      '<tr><td>ZE*</td><td>Shetland</td></tr>' +
      '</table>'
  },
  {
    department: 'logistics', type: 'sop', title: 'Special product rules & EVA mats', verified_on: '2026-06-01',
    config_json: { summary: 'Fixed product overrides and the EVA set/piece logic.' },
    body_html: '<h4>Fixed product rules (apply yourself)</h4>' +
      '<table class="sop"><tr><th>Product</th><th>Rule</th></tr>' +
      '<tr><td>Vibration plates</td><td>One Day service</td></tr>' +
      '<tr><td>Exercise bikes</td><td>One Day service</td></tr>' +
      '<tr><td>Stepper (Lily Batch \u2014 Plan21543)</td><td>Hermes Next Day</td></tr></table>' +
      '<h4>EVA mats</h4><p><b>1 set = 4 pieces.</b> Box: 60\u00d760 \u2192 6 sets, 30\u00d730 \u2192 6 sets, 2.5 mm \u2192 3 sets.</p>' +
      '<table class="sop"><tr><th>Courier</th><th>Per-order piece limits</th></tr>' +
      '<tr><td>Hermes / Evri</td><td>2.5 \u2192 4 or 8 \u00b7 30\u00d730 \u2192 80 \u00b7 60\u00d760 \u2192 12 \u00b7 12MM \u2192 12 \u00b7 Cartoon \u2192 12</td></tr>' +
      '<tr><td>Yodel</td><td>2.5 \u2192 8 \u00b7 60\u00d760 \u2192 16 \u00b7 12MM \u2192 16 \u00b7 Cartoon \u2192 16</td></tr>' +
      '<tr><td>DHL</td><td>60\u00d760 \u2192 24 (Next Day Large) / 28 (Next Day XL) \u00b7 2.5 (12) \u2192 One Day Large</td></tr></table>'
  },
  {
    department: 'logistics', type: 'sop', title: 'Decision authority \u2014 fix it or escalate', verified_on: '2026-06-01',
    config_json: { summary: 'What you decide on your own vs what must go to the supervisor.' },
    body_html: '<table class="sop"><tr><th>Decision</th><th>Authority</th></tr>' +
      '<tr><td>Reassign a courier (within the SOP)</td><td>\u2705 Independent</td></tr>' +
      '<tr><td>Split a multi-item order</td><td>\u2705 Independent</td></tr>' +
      '<tr><td>Delay a pickwave for an unresolved error</td><td>\u2705 Independent</td></tr>' +
      '<tr><td>Apply a product override (e.g. One Day for vibration plates)</td><td>\u2705 Independent</td></tr>' +
      '<tr><td>Remove customer email on Temu DHL/Yodel</td><td>\u2705 Independent (mandatory)</td></tr>' +
      '<tr><td>Modify or create an order missing from Linnworks</td><td>\u274c Escalate</td></tr>' +
      '<tr><td>Use a courier not in the SOP</td><td>\u274c Escalate</td></tr>' +
      '<tr><td>Override a product-specific rule</td><td>\u274c Escalate</td></tr></table>' +
      '<div class="warn">The DX contact number (01733 566056) is fixed and cannot be changed by this role.</div>'
  },
  {
    department: 'logistics', type: 'sop', title: 'Common label errors & the fix', verified_on: '2026-06-01',
    config_json: { summary: 'The real errors from the warehouse and exactly how to clear each.' },
    body_html: '<table class="sop"><tr><th>Error</th><th>Fix</th></tr>' +
      '<tr><td>Shipping service not available on Amazon (SWA-UK-PREM)</td><td>Run Quotes, reassign to a courier it fits.</td></tr>' +
      '<tr><td>\u201cI want 2 labels for this order\u201d</td><td>Split into two packages, generate both labels.</td></tr>' +
      '<tr><td>Emails / Product Identifier required</td><td>Add the missing field on the order.</td></tr>' +
      '<tr><td>Yodel address/email too long</td><td>Shorten address; add info@fksports.co.uk if email missing.</td></tr>' +
      '<tr><td>Evri/Hermes Next Day unavailable for postcode</td><td>Switch to Hermes Tracked or a courier that serves it.</td></tr></table>'
  },
  {
    department: 'logistics', type: 'sop', title: 'Despatch Coordinator \u2014 full role spec (SOW)', verified_on: '2026-06-01',
    config_json: { summary: 'The complete role: purpose, all nine responsibilities, authority and what good looks like.' },
    body_html:
      '<p><b>Role:</b> Despatch Coordinator \u2014 Courier &amp; Shipping (SOW-WH-003). Desk-based, remote. Primary system <b>Linnworks</b>. Platforms: <b>Amazon, Temu, OneBuy, Shopify</b>. Reports to the Warehouse / Operations Supervisor.</p>' +
      '<h4>Purpose</h4><p>You are the last line of defence before an order reaches the warehouse floor. You make sure every order has the correct, cost-effective courier and is error-free before the pickwave is released. You do not physically handle stock.</p>' +
      '<h4>The nine responsibilities</h4><ol>' +
      '<li>Manage the order queue across all four platforms in Linnworks.</li>' +
      '<li>Review courier auto-assignment and correct it where the engine is wrong.</li>' +
      '<li>Identify and correct order errors before release.</li>' +
      '<li>Reconcile orders across the four platforms \u2014 escalate anything missing, never create it.</li>' +
      '<li>Flag and handle surcharge postcodes.</li>' +
      '<li>Apply the Temu data rule (remove customer email on Temu DHL/Yodel orders).</li>' +
      '<li>Make split decisions on oversized / multi-item orders.</li>' +
      '<li>Enforce product-specific rules.</li>' +
      '<li>Release the pickwave \u2014 your clean sign-off that the wave is ready.</li></ol>' +
      '<h4>Decision authority</h4><p><b>Independent:</b> reassign couriers within the SOP, split orders, delay a wave for an error, apply product overrides, remove Temu emails. <b>Escalate:</b> create/modify a missing order, use a non-SOP courier, override a product rule.</p>' +
      '<div class="warn">Measured on accuracy, not speed. At end of day every platform is clear, every courier collected, the day reported and filed.</div>'
  },
  {
    department: 'logistics', type: 'sop', title: 'Pickwave &amp; courier SOP \u2014 full document', verified_on: '2026-06-01',
    config_json: { summary: 'The full operating procedure: the five checks, courier limits, splitting, release and end-of-day.' },
    body_html:
      '<h4>1. The five pre-release checks (every order)</h4><ol>' +
      '<li><b>Postcode</b> \u2014 on the surcharge list? Handle the surcharge or reroute.</li>' +
      '<li><b>Gross weight</b> \u2014 within the courier\u2019s limit?</li>' +
      '<li><b>Length</b> \u2014 within the courier\u2019s max length?</li>' +
      '<li><b>Volume / CBM</b> \u2014 L\u00d7B\u00d7H\u00f71000 = litres (or Yodel online CBM).</li>' +
      '<li><b>Cancelled / duplicate</b> \u2014 none in the wave.</li></ol>' +
      '<h4>2. Courier limits</h4>' +
      '<table class="sop"><tr><th>Courier</th><th>Limits</th><th>Volume</th></tr>' +
      '<tr><td>Amazon / Prime</td><td>Auto; don\u2019t change postage</td><td>\u00f71000 &lt; 40 L (one box)</td></tr>' +
      '<tr><td>Yodel</td><td>&lt; 17 kg, \u2264 90 cm</td><td>CBM &lt; 0.113 m\u00b3</td></tr>' +
      '<tr><td>Evri (Hermes)</td><td>\u2264 15 kg, \u2264 120 cm</td><td>\u00f71000 &lt; 40 L</td></tr>' +
      '<tr><td>DX Standard</td><td>\u2264 150 cm, \u2264 25 kg</td><td>\u00f75000; split &gt; 25</td></tr>' +
      '<tr><td>DX Overnight</td><td>No limit \u2014 heavy gym kit</td><td>\u2014</td></tr>' +
      '<tr><td>DHL</td><td>\u2264 30 kg</td><td>\u00f75000; split &gt; 30</td></tr></table>' +
      '<h4>3. Splitting</h4><p>Mixed light + heavy orders: split by item onto the courier each fits, then split the heavy side into packages within that courier\u2019s weight cap. Your independent call within the rules.</p>' +
      '<h4>4. Special handling</h4><p>Vibration plates / exercise bikes \u2192 One Day. Stepper Lily Batch (Plan21543) \u2192 Hermes Next Day. Temu on DHL/Yodel \u2192 remove the customer email. Restricted Amazon items \u2192 Run Quotes, then reassign. DX number 01733 566056 is fixed.</p>' +
      '<h4>5. Release &amp; end of day</h4><p>Baskets \u2192 generate pickwave \u2192 release (your sign-off) \u2192 log on Monday.com (pickwave ID, orders, boxes, courier, picker, status) \u2192 watch the clocks. End of day: reconcile all four platforms, every courier collected, report and file. Missing platform order \u2192 escalate.</p>'
  },
  {
    department: 'logistics', type: 'flashcard', title: 'Drill the numbers', verified_on: '2026-06-01',
    config_json: { summary: 'Flip-cards to drill the limits until they\u2019re automatic.',
      cards: [
        { q: 'Yodel \u2014 weight & length limit?', a: '< 17 kg, \u2264 90 cm (CBM < 0.113 m\u00b3)' },
        { q: 'Evri (Hermes) \u2014 limits?', a: '\u2264 15 kg, \u2264 120 cm, \u00f71000 < 40 L' },
        { q: 'Amazon/Prime \u2014 volume for one box?', a: 'L\u00d7B\u00d7H\u00f71000 < 40 L (over 40 = split)' },
        { q: 'DX Standard \u2014 limits & formula?', a: '\u2264 150 cm, \u2264 25 kg, \u00f75000; split > 25' },
        { q: 'DHL \u2014 weight cap & split?', a: '\u2264 30 kg (dead or volumetric); \u00f75000, split > 30' },
        { q: 'Vibration plates & exercise bikes?', a: 'One Day service' },
        { q: 'Stepper Lily Batch (Plan21543)?', a: 'Hermes Next Day' },
        { q: 'Temu on DHL/Yodel \u2014 before release?', a: 'Remove the customer email in Linnworks' },
        { q: '1 EVA set = how many pieces?', a: '4 pieces' },
        { q: 'Order missing from Linnworks?', a: 'Escalate \u2014 never create it yourself' }
      ] }
  }
];

const stockinCourse = {
  slug: 'stockin-coordinator',
  title: 'Stock-In — Despatch Coordinator',
  department: 'logistics',
  competency_key: 'stockin_ready',
  recert_months: 12,
  sessions: [
    {
      title: 'The role, and the one principle',
      est: 14, tier: 1,
      objective: 'Understand that stock-in is a remote desk job, where the line sits between you and the warehouse, and the principle the whole job hangs off.',
      body_html:
        '<p>Stock-in is a <b>desk job</b>, done remotely. The warehouse \u2014 in the UK \u2014 unloads, counts and physically puts stock away. You never do. Your job is the <b>data and the paperwork</b>: build the Purchase Order, hand the warehouse the right list, verify what they report back, and commit it to Linnworks so inventory is correct.</p>' +
        '<p><b>The principle the whole job hangs off:</b> we should receive exactly what we paid for. The PO is your claim of what is owed. Every count, every check, every escalation exists to prove that claim or expose where it broke.</p>',
      checks: [
        { type: 'scenario', tag: 'Judgement',
          prompt: 'The warehouse messages you a photo of two crushed cartons and asks what to do with them. You are at a desk, in another country. What is the right response?',
          options: [
            { text: 'Decide from the photo whether the contents are still sellable and tell them', correct: false, fb: 'You cannot judge sellable condition of physical goods from a photo a continent away. That assessment is theirs, hands-on.' },
            { text: 'They assess and record the damage through their own goods-in process and report the actual sellable count; you record that actual and escalate any shortfall to your manager', correct: true, fb: 'The physical call is theirs; your job is to act on the numbers they report and surface any gap.', cost: 'Reaching across the world to run their physical process slows them down and blurs who is accountable for the count.' },
            { text: 'Tell them to count the damaged cartons as received so the PO still matches', correct: false, fb: 'Never massage a count to fit the PO. Damage is exactly what the process is meant to surface.' },
            { text: 'Tell them to bin the cartons straight away', correct: false, fb: 'Not your call, and not the process \u2014 damaged stock is quarantined and recorded, not binned on a remote say-so.' },
          ] },
        { type: 'scenario',
          prompt: 'Which single statement best describes what you are accountable for?',
          options: [
            { text: 'Physically receiving and counting the stock accurately', correct: false, fb: 'That is the warehouse. You never count physical stock.' },
            { text: 'Making the Linnworks record match what we paid for \u2014 and exposing it when it does not', correct: true, fb: 'You own the data truth, not the box.', cost: 'If you think the job is the boxes, you will undervalue the part that actually matters: the record.' },
            { text: 'Making sure the warehouse hits its unloading targets', correct: false, fb: 'Not your remit. You do not manage warehouse productivity.' },
          ] },
        { type: 'scenario', tag: 'Aptitude',
          prompt: 'Read these four statements about your role. Three are consistent with each other; one contradicts the rest. Which is the odd one out?',
          options: [
            { text: 'You never physically handle stock', correct: false, fb: 'Consistent with the role.' },
            { text: 'You build the PO from the paid invoice', correct: false, fb: 'Consistent with the role.' },
            { text: 'You personally unload and count each container', correct: true, fb: 'This one contradicts the other three. You are a remote desk role; unloading and counting is the warehouse\u2019s job.', cost: 'If you cannot spot which statement breaks the pattern, you will miss the same kind of contradiction in a delivery sheet.' },
            { text: 'You commit the receipt in Linnworks after verification', correct: false, fb: 'Consistent with the role.' },
          ] },
      ],
    },
    {
      title: 'Raising the PO from the invoice',
      est: 14, tier: 1,
      objective: 'Build the Purchase Order from the paid invoice \u2014 the source of truth \u2014 with cost on every line, and resist the wrong-number traps.',
      body_html:
        '<p>Once final payment is made to the supplier, you build the Purchase Order in Linnworks <b>from the paid invoice</b> \u2014 every SKU, every quantity, and the <b>cost</b> on each line. Not from the proforma, not from a chat message, not from the packing list. The invoice is what we paid; the PO is what we are owed.</p>' +
        '<p>Put the <b>cost on the PO line now</b>, from the invoice in front of you. It saves keying a price later at stock-in \u2014 and stops a \u00a30 slipping into inventory valuation.</p>',
      checks: [
        { type: 'scenario', tag: 'Judgement',
          prompt: 'The supplier\u2019s proforma quoted 500 units. After negotiation you paid for 450. The packing list that arrives later says 460 are on the truck. What quantity goes on the Purchase Order?',
          options: [
            { text: '500 \u2014 the original proforma', correct: false, fb: 'The proforma is a quote, not what we paid. Irrelevant once the deal is done.' },
            { text: '450 \u2014 the paid invoice', correct: true, fb: 'The PO is built from what we PAID for. The container claiming 460 is a +10 you will surface at counting \u2014 not something you bake in early.', cost: 'Build from 460 and you have quietly accepted a 10-unit over-ship as \u2018expected\u2019 \u2014 the discrepancy check can never catch it.' },
            { text: '460 \u2014 the packing list, since that is what is coming', correct: false, fb: 'The packing list is the supplier\u2019s claim of what they shipped \u2014 not proof, and not what we paid. If it differs from the invoice, that is a flag, not a correction.' },
            { text: 'Wait until the warehouse counts, then enter that number', correct: false, fb: 'Then the PO can never be \u2018wrong\u2019 \u2014 you have removed the whole point of it. The PO must exist before the goods, as the thing reality is checked against.' },
          ] },
        { type: 'scenario',
          prompt: 'You are building a PO with 6 SKUs. On one line the invoice cost is smudged and unreadable. What do you do?',
          options: [
            { text: 'Leave the cost blank / \u00a30 and fix it later', correct: false, fb: 'A \u00a30 cost flows into stock valuation and margin. \u2018Later\u2019 is how it becomes permanent.' },
            { text: 'Estimate it from the retail price', correct: false, fb: 'Retail is not cost. You would be inventing a margin-distorting number.' },
            { text: 'Get the correct cost confirmed from the invoice or supplier before completing that line', correct: true, fb: 'The cost has one correct source. Confirm it, do not guess it.', cost: 'A guessed cost silently corrupts every margin report that SKU ever appears in.' },
          ] },
        { type: 'scenario', tag: 'Aptitude',
          prompt: 'A PO line is for 240 units at \u00a32.00 each. The invoice total for that line reads \u00a34.80. Before you accept it, what should you notice?',
          options: [
            { text: 'Looks fine \u2014 enter it as \u00a34.80', correct: false, fb: '240 \u00d7 \u00a32.00 = \u00a3480, not \u00a34.80. You have just accepted a figure that is out by a hundred-fold.' },
            { text: '240 \u00d7 \u00a32.00 = \u00a3480 \u2014 the \u00a34.80 is almost certainly a misplaced decimal; query it before accepting', correct: true, fb: 'A quick sanity-multiply catches a decimal error that would otherwise wreck the line value.', cost: 'Numbers that do not survive a five-second multiply are exactly the ones that corrupt your stock valuation.' },
            { text: 'Adjust the unit cost down to 2p so it matches \u00a34.80', correct: false, fb: 'You would be bending the unit cost to fit a wrong total \u2014 inventing a second error to hide the first.' },
          ] },
      ],
    },
    {
      title: 'The packing list to the warehouse',
      est: 12, tier: 1,
      objective: 'Send the warehouse the right list at the right time, and never confuse cartons with pieces.',
      body_html:
        '<p>A day before the container lands, you send the warehouse a <b>packing list</b>: barcode, item name, quantity, number of boxes, and number of cartons. They check physically against this.</p>' +
        '<p><b>A carton is not a piece.</b> One carton can hold many units. The warehouse counts <b>pieces</b> against your number, so the packing list must state pieces \u2014 get the carton-to-piece maths right or the count is meaningless.</p>',
      checks: [
        { type: 'scenario', tag: 'Aptitude',
          prompt: 'SKU FK-YOGA-M ships as 12 cartons. Each carton holds 24 pieces. What piece quantity do you put on the packing list for this SKU?',
          options: [
            { text: '12', correct: false, fb: 'That is cartons, not pieces. The warehouse would \u2018receive 12\u2019 and 276 units would vanish from the record.' },
            { text: '24', correct: false, fb: 'That is one carton\u2019s contents, not the shipment.' },
            { text: '288', correct: true, fb: '12 \u00d7 24. Pieces is what gets counted and stocked in.', cost: 'Carton/piece confusion is the single most common goods-in counting error \u2014 it hides hundreds of units.' },
            { text: '36', correct: false, fb: 'That is 12 + 24. There is no scenario where you add them.' },
          ] },
        { type: 'scenario',
          prompt: 'Which of these does NOT belong on the packing list you send the warehouse?',
          options: [
            { text: 'Barcode', correct: false, fb: 'Belongs \u2014 it is how they identify each line.' },
            { text: 'Unit cost / price', correct: true, fb: 'Price lives on the invoice and the PO, never on the warehouse packing list. They count goods; they have no business with cost.', cost: 'Putting cost on a warehouse-facing sheet leaks commercial data to people who do not need it.' },
            { text: 'Number of cartons', correct: false, fb: 'Belongs \u2014 it helps them reconcile cartons to pieces.' },
            { text: 'Item name', correct: false, fb: 'Belongs \u2014 barcode plus name reduces mis-identification.' },
          ] },
        { type: 'scenario', tag: 'Aptitude',
          prompt: 'The supplier\u2019s note for SKU-A says: 8 cartons, 18 pieces per carton, and writes the total as 124. What do you put on the packing list, and do you flag anything?',
          options: [
            { text: 'Put 124 \u2014 it is the supplier\u2019s stated total', correct: false, fb: '8 \u00d7 18 = 144. The supplier\u2019s own total contradicts their own carton figures. Copying 124 propagates their error.' },
            { text: 'Put 144 (8 \u00d7 18) and flag the supplier\u2019s inconsistent total before the goods ship', correct: true, fb: 'You spotted the contradiction, used the figure that is actually supported, and raised it \u2014 that is the job.', cost: 'A learner who does not multiply-check the supplier\u2019s numbers will let their arithmetic mistakes become your stock errors.' },
            { text: 'Put 144 and say nothing', correct: false, fb: 'The maths is right, but a silent fix leaves an unexplained mismatch between the note and your list. Flag it.' },
          ] },
      ],
    },
    {
      title: 'Verifying the count, authorising put-away',
      est: 15, tier: 2,
      objective: 'Verify the warehouse\u2019s reported count (you cannot recount), record actual not assumed, and respect the order of operations.',
      body_html:
        '<p>The warehouse counts and marks your packing list: against what you said was coming, here is what we actually got \u2014 full or short. <b>You verify that report</b> (you do not recount \u2014 you cannot, you are remote) and then <b>authorise put-away</b>.</p>' +
        '<p>Record <b>actual</b>, never assumed. If they received less than the PO, you stock in the actual figure and <b>escalate the gap</b> \u2014 you never edit the number to make it match.</p>',
      checks: [
        { type: 'scenario', tag: 'Judgement',
          prompt: 'You expected 288 of a SKU. The warehouse has counted, marked the sheet \u2018264 received\u2019, and signed it. What do you do?',
          options: [
            { text: 'Change the PO to 264 so everything reconciles cleanly', correct: false, fb: 'That erases the evidence of a 24-unit shortfall. Now nobody knows we were short-shipped.' },
            { text: 'Proceed with the actual 264, and escalate the 24-unit shortfall to your manager', correct: true, fb: 'Actual goes in; the gap gets raised. That is the whole control.', cost: 'Adjusting to match the PO is how short-shipments go unclaimed and money walks out the door.' },
            { text: 'Tell the warehouse to recount until they find the missing 24', correct: false, fb: 'They have counted and signed. A short-ship is a supplier issue to claim, not a counting failure to bully away.' },
            { text: 'Refuse the whole delivery', correct: false, fb: 'Disproportionate and not your call \u2014 you accept the actual and escalate.' },
          ] },
        { type: 'scenario',
          prompt: 'The warehouse has counted and marked the sheet, but has not put anything away yet. Can you start stocking in to Linnworks now?',
          options: [
            { text: 'Yes \u2014 you have the quantities, that is enough', correct: false, fb: 'You are missing the locations. Stock-in needs barcode, location AND quantity \u2014 and locations only exist after put-away.' },
            { text: 'No \u2014 authorise put-away first; you stock in from the delivery sheet, which only exists once they have put it away', correct: true, fb: 'Verify count \u2192 authorise put-away \u2192 warehouse returns the delivery sheet (with locations) \u2192 then you stock in.', cost: 'Stock in before put-away and you are inventing locations \u2014 pickers get sent to empty shelves.' },
          ] },
        { type: 'scenario',
          prompt: 'Totals match (288 received, 288 expected) \u2014 but one SKU is 10 short and a different SKU is 10 over. The warehouse asks if it is fine since it \u2018nets out\u2019.',
          options: [
            { text: 'Yes, the totals match, so record it and move on', correct: false, fb: 'Two SKUs are wrong. Netting hides a supplier mis-pack and will cause two future stock errors.' },
            { text: 'No \u2014 record each SKU\u2019s actual figure and escalate both the short and the over', correct: true, fb: 'Stock is per-SKU, never a pooled total. A +10/-10 is two problems, not zero.', cost: '\u2018It nets out\u2019 is how mis-packs enter your inventory and surface later as phantom stock and mis-picks.' },
          ] },
        { type: 'scenario', tag: 'Aptitude',
          prompt: 'Read carefully. The warehouse reports: \u2018SKU-B expected 200, received 220. SKU-C expected 150, received 150.\u2019 Which line needs a discrepancy raised \u2014 and is it short or over?',
          options: [
            { text: 'SKU-B, short', correct: false, fb: 'Read again: SKU-B received 220 against 200 expected. That is over, not short.' },
            { text: 'SKU-B, over by 20', correct: true, fb: '220 vs 200 is a +20. SKU-C matches exactly, so it is clean.', cost: 'Misreading \u2018over\u2019 as \u2018short\u2019 sends the wrong claim to the supplier and makes you look like you cannot read your own sheets.' },
            { text: 'SKU-C, over', correct: false, fb: 'SKU-C is 150 vs 150 \u2014 exact. Look again.' },
            { text: 'Neither \u2014 totals are close enough', correct: false, fb: 'A 20-unit over on SKU-B is a real discrepancy, not a rounding nicety.' },
          ] },
      ],
    },
    {
      title: 'Stocking in to Linnworks',
      est: 16, tier: 2,
      objective: 'Commit the receipt correctly from the delivery sheet \u2014 the right source, the must-tick box, and the \u00a30-price rule.',
      body_html:
        '<p>Now you commit it. Open the <b>PO on one side</b> and the <b>Stock In</b> screen on the other, and work from the <b>delivery sheet</b> the warehouse returned (barcode, location, quantity). For each line you <b>enter the barcode, the location and the quantity</b> \u2014 you are typing them in from the sheet, not scanning anything.</p>' +
        '<p>Make sure <b>\u201cDeliver in purchase order\u201d is ticked.</b> That is what links the receipt to the PO. With it ticked, Linnworks puts the item into inventory at that location and quantity. Work through every line until the whole sheet is in.</p>' +
        '<p>Price is usually fetched automatically. If it shows <b>\u00a30</b>, key it in from the invoice you hold \u2014 never leave it.</p>',
      checks: [
        { type: 'scenario',
          prompt: 'Which sheet do you stock in FROM?',
          options: [
            { text: 'The packing list you sent the warehouse', correct: false, fb: 'That is the expected list \u2014 no real locations, no confirmed actuals. Wrong source.' },
            { text: 'The delivery sheet the warehouse returns after put-away', correct: true, fb: 'It carries the real barcode \u2192 location \u2192 quantity. That is what Linnworks needs.', cost: 'Stock in from the packing list and your locations are guesses \u2014 pickers get routed to the wrong shelves.' },
            { text: 'The supplier\u2019s invoice', correct: false, fb: 'The invoice built the PO and holds the cost \u2014 it has no location data.' },
          ] },
        { type: 'scenario', tag: 'Judgement',
          prompt: 'You stock in six lines. On two of them you forget to tick \u2018Deliver in purchase order\u2019. What actually happens?',
          options: [
            { text: 'Nothing \u2014 the tick is cosmetic', correct: false, fb: 'It is not cosmetic; it is the link to the PO.' },
            { text: 'Those two items are not marked against the PO, so the PO still reads as undelivered and your numbers will not reconcile', correct: true, fb: 'The stock may move but the receipt is not tied to the PO \u2014 reconciliation breaks and the second checker will catch a PO that looks part-delivered.', cost: 'An untied receipt means the PO never closes \u2014 \u2018received but not on PO\u2019 stock is exactly where audits fail.' },
            { text: 'Linnworks blocks the entry until you tick it', correct: false, fb: 'It will not save you \u2014 the box can be left unticked, which is precisely why it is drilled.' },
          ] },
        { type: 'scenario',
          prompt: 'You enter a barcode and the price field shows \u00a30.00. The invoice in your folder lists this SKU\u2019s cost. What do you do?',
          options: [
            { text: 'Leave it at \u00a30 \u2014 pricing is not your job', correct: false, fb: 'A \u00a30 cost corrupts stock valuation and every margin calc for this SKU.' },
            { text: 'Key the cost in from the invoice you hold, then continue', correct: true, fb: 'You have the one correct source in your hand \u2014 use it.', cost: '\u00a30 costs are silent: nothing breaks visibly, but every profitability number using that SKU is now wrong.' },
            { text: 'Use the last selling price you remember', correct: false, fb: 'Selling price is not cost. Do not invent a figure.' },
          ] },
        { type: 'scenario', tag: 'Aptitude',
          prompt: 'Three facts: verifying the count comes before authorising put-away; put-away comes before the delivery sheet exists; you stock in from the delivery sheet. What is the earliest moment you could possibly stock in?',
          options: [
            { text: 'As soon as the container is counted', correct: false, fb: 'Counting is before put-away, and put-away is before the delivery sheet \u2014 so you still have no sheet to stock in from.' },
            { text: 'Only after put-away is done and the delivery sheet exists', correct: true, fb: 'Chain the three facts and the delivery sheet is the gate \u2014 nothing can be stocked in before it.', cost: 'If you cannot follow a three-step dependency, you will try to stock in with no locations and create phantom shelf data.' },
            { text: 'Any time after the PO is raised', correct: false, fb: 'The PO is far upstream. The blocking step is the delivery sheet, which only the warehouse can produce after put-away.' },
          ] },
      ],
    },
    {
      title: 'Confirming the PO, and the second check',
      est: 13, tier: 2,
      objective: 'Close the PO out, escalate what will not reconcile, and understand who verifies you and what that check can and cannot catch.',
      body_html:
        '<p>Once every line is in, confirm the <b>whole PO has been delivered</b> in Linnworks. Anything that will not reconcile \u2014 a line short, a barcode that will not match, a price you cannot source \u2014 goes to <b>your manager</b>. You do not self-correct discrepancies.</p>' +
        '<p>Then a <b>second office coordinator</b> independently reconfirms \u2014 never you re-checking your own work, and never the warehouse. They open inventory, <b>enter each barcode</b>, and confirm the <b>location, the quantity, and the plan (batch) number</b> are right.</p>',
      checks: [
        { type: 'scenario',
          prompt: 'Who performs the second check on your stock-in?',
          options: [
            { text: 'You, re-reading your own entries', correct: false, fb: 'Self-checking catches almost nothing \u2014 you repeat your own blind spots. The point is independence.' },
            { text: 'The warehouse operative who put the stock away', correct: false, fb: 'They handled the physical side and cannot see your Linnworks entries. Also not independent of the put-away.' },
            { text: 'A second office coordinator, independently', correct: true, fb: 'A different set of eyes in the office, checking the data you committed.', cost: 'Skip independence and a fat-fingered location or quantity sails straight into live inventory.' },
            { text: 'Your manager signs off every one', correct: false, fb: 'Your manager is for escalations, not routine line-by-line verification.' },
          ] },
        { type: 'scenario', tag: 'Judgement',
          prompt: 'What does that second coordinator actually verify \u2014 and what can they NOT verify?',
          options: [
            { text: 'They re-count the physical stock to confirm the quantity is truly there', correct: false, fb: 'They cannot \u2014 they are in the office, not the warehouse. They verify the record, not the shelf.' },
            { text: 'They confirm the location, quantity and plan/batch number in the record are correct \u2014 they cannot re-validate the physical count', correct: true, fb: 'Their check catches data-entry errors. The physical count was the warehouse\u2019s job and already happened.', cost: 'Assuming the office check re-proves the physical count gives false confidence \u2014 two checks that catch different things, not the same thing twice.' },
          ] },
        { type: 'scenario',
          prompt: '\u2018Plan number\u2019 on the check refers to\u2026',
          options: [
            { text: 'The aisle plan / floor layout of the warehouse', correct: false, fb: 'Nothing to do with warehouse layout.' },
            { text: 'The supplier batch / plan reference for that order (e.g. Plan 4.1, Lily)', correct: true, fb: 'Each supplier order carries its own plan/batch number; the second checker confirms it is the right one.', cost: 'A wrong plan number means stock is traced to the wrong batch \u2014 a problem the day you need to trace a fault or a recall.' },
          ] },
        { type: 'scenario', tag: 'Aptitude',
          prompt: 'A stock report shows a SKU split across locations A1 = 40, A2 = 40, A3 = 40, A7 = 40. The warehouse confirms aisle A has only three bays, A1 to A3. What is the issue?',
          options: [
            { text: 'Nothing \u2014 four locations, four counts, it adds up to 160', correct: false, fb: 'The total is not the point. A7 is named in a report for an aisle that has no seventh bay.' },
            { text: 'A7 cannot exist in an aisle of three bays \u2014 the record has a location that is not real, so flag it', correct: true, fb: 'You cross-checked the data against a known constraint and caught an impossible location.', cost: 'A learner who does not notice an impossible location will trust any figure a screen shows them.' },
            { text: 'Move the A7 stock to A1', correct: false, fb: 'You do not quietly \u2018fix\u2019 a phantom location by inventing a move. Flag it and find out what really happened.' },
          ] },
      ],
    },
    {
      title: 'Returns, and the monthly count',
      est: 13, tier: 2,
      objective: 'Run returns through the same disciplined flow, and own the monthly count from report to reconciliation.',
      body_html:
        '<p><b>Returns that are fit to resell</b> come in too. The warehouse sends you their return list (often a <b>photo</b> \u2014 they are in the UK, you are not). You run the <b>same flow</b>: raise a PO, stock it in, make a <b>delivery sheet</b>, and <b>file it for audit</b> \u2014 tagged as a return. You also keep the warehouse\u2019s original list.</p>' +
        '<p>Once a month you run the <b>full warehouse count</b>: pull the Linnworks stock report, <b>sort it location-wise</b>, send it to the warehouse to count physically, take it back, reconcile, and list any differences (plus or minus) to escalate to your manager.</p>',
      checks: [
        { type: 'scenario',
          prompt: 'A resellable return arrives and the warehouse sends you a photo of their return sheet. Which is the complete, correct set of steps?',
          options: [
            { text: 'Just add the quantities back into Linnworks inventory directly', correct: false, fb: 'That skips the PO, the delivery sheet and the audit trail. No record of where it came from.' },
            { text: 'Raise a PO, stock it in, make a delivery sheet, and file it tagged as a return \u2014 keeping the warehouse\u2019s list too', correct: true, fb: 'Identical discipline to a container, just labelled as a return.', cost: 'Returns stocked in \u2018quickly\u2019 with no delivery sheet are invisible to audit \u2014 the most common source of phantom resale stock.' },
            { text: 'Email your manager to add the stock', correct: false, fb: 'This is your job, done through the normal flow \u2014 not an escalation.' },
          ] },
        { type: 'scenario', tag: 'Judgement',
          prompt: 'Before sending the monthly stock report to the warehouse to count, what must you do, and why?',
          options: [
            { text: 'Send it as-is in SKU order \u2014 they will find everything', correct: false, fb: 'In SKU order the warehouse crisscrosses the whole building for each line. Slow and error-prone.' },
            { text: 'Sort it location-wise, so the warehouse can count bay by bay in one walk', correct: true, fb: 'Location order lets them sweep the building systematically \u2014 faster and far more accurate.', cost: 'A SKU-ordered count sheet turns a clean count into a chaotic treasure hunt, and the numbers come back unreliable.' },
          ] },
        { type: 'scenario',
          prompt: 'The monthly count comes back: 3 SKUs over, 2 SKUs under. What do you do?',
          options: [
            { text: 'Adjust Linnworks to match the physical count so it is correct', correct: false, fb: 'Adjusting stock yourself, unsigned, is exactly where shrinkage and fraud hide. Not your call alone.' },
            { text: 'List the differences (+/-) and escalate to your manager \u2014 adjustments wait for sign-off', correct: true, fb: 'You surface the discrepancies; the correction is authorised, not silent.', cost: 'Unsigned stock adjustments are an auditor\u2019s first red flag \u2014 every change needs a name against it.' },
            { text: 'Ignore small differences and only report large ones', correct: false, fb: 'You do not get to decide what is \u2018small\u2019. Report all of it; let the sign-off judge.' },
          ] },
        { type: 'scenario', tag: 'Aptitude',
          prompt: 'Last month\u2019s count found 6 discrepancies across 1,200 line-items. This month it is 60 across the same 1,200. What is the sensible read?',
          options: [
            { text: 'Just more errors this month \u2014 report them and move on', correct: false, fb: 'A ten-fold jump in the same-size count is not \u2018a few more\u2019. That scale of change points at a process problem, not bad luck.' },
            { text: 'A 10\u00d7 jump on an unchanged base is a signal in itself \u2014 report the discrepancies AND flag that something in the process likely broke', correct: true, fb: 'You read the proportion, not just the raw number, and escalated the pattern as well as the items.', cost: 'A learner who only sees \u201860 errors\u2019 and not \u201810\u00d7 worse than normal\u2019 misses the warning that matters most.' },
            { text: '60 out of 1,200 is only 5%, so it is within tolerance', correct: false, fb: 'Against last month\u2019s 0.5%, 5% is a tenfold deterioration \u2014 \u2018within tolerance\u2019 is exactly the wrong conclusion.' },
          ] },
      ],
    },
    {
      title: 'Capstone \u2014 one delivery, start to finish',
      est: 18, tier: 3,
      objective: 'Put it all together under pressure: actual-not-assumed, tied to the PO, discrepancy surfaced, and never trust a flag over your own maths.',
      body_html:
        '<p>A real container, with the traps you have met now woven together. Read carefully \u2014 each answer assumes the steps before it were done right.</p>',
      checks: [
        { type: 'scenario', tag: 'Judgement',
          prompt: 'You paid an invoice for 450 units across 3 SKUs and built the PO from it (cost on each line). SKU-A is 5 cartons \u00d7 30. The warehouse counts and marks: SKU-A received 144, not 150; SKU-B and SKU-C full. They sign, put away, and return a delivery sheet with locations. What is your next action?',
          options: [
            { text: 'Stock in SKU-A as 150 to match the PO, since it is \u2018close enough\u2019', correct: false, fb: 'Never. 144 is the actual. The 6-unit gap is a claim against the supplier, not a rounding error.' },
            { text: 'Stock in the actuals (SKU-A at 144) from the delivery sheet with \u2018Deliver in purchase order\u2019 ticked, then escalate the 6-unit SKU-A shortfall to your manager', correct: true, fb: 'Actuals in, linked to the PO, gap escalated. Textbook.', cost: 'This is the whole course in one move: actual-not-assumed, tied to the PO, discrepancy surfaced.' },
            { text: 'Hold the entire delivery until the 6 units are found', correct: false, fb: 'You do not freeze 444 good units over a 6-unit supplier shortfall. Stock the actuals, escalate the gap.' },
          ] },
        { type: 'scenario', tag: 'Aptitude',
          prompt: 'Final glance before you confirm: the PO header says 450 units total; your stocked-in lines read SKU-A 144 + SKU-B 150 + SKU-C 150 = 444. Yet the PO is showing \u2018fully delivered\u2019. What does that tell you?',
          options: [
            { text: 'All good \u2014 the system says fully delivered, so it is', correct: false, fb: '444 is not 450. A PO that is 6 short cannot be truly \u2018fully delivered\u2019 \u2014 the flag and your numbers disagree.' },
            { text: '444 \u2260 450, so a PO marked \u2018fully delivered\u2019 is contradicting your own figures \u2014 stop and investigate before trusting the flag', correct: true, fb: 'You added the lines, compared to the header, and refused to trust a status that the maths contradicts.', cost: 'Trusting a green \u2018delivered\u2019 flag over your own arithmetic is how a short-shipped PO gets quietly closed and the claim is lost.' },
            { text: 'Edit a line up by 6 so the total hits 450', correct: false, fb: 'That is inventing stock to satisfy a flag \u2014 the exact fraud the whole process exists to prevent.' },
          ] },
        { type: 'scenario',
          prompt: 'You finish stocking in. SKU-C\u2019s price came through as \u00a30 and you keyed it from the invoice. One barcode on SKU-B would not auto-match so you entered the SKU manually. The PO now shows fully delivered (and reconciles). What happens next?',
          options: [
            { text: 'You are done \u2014 close it and move on', correct: false, fb: 'Not yet. Every stock-in gets an independent second check before it is truly closed.' },
            { text: 'A second office coordinator independently confirms location, quantity and plan number against the record', correct: true, fb: 'Independent verification is the final gate \u2014 especially after a manual SKU entry and a hand-keyed price.', cost: 'The manual entry and the \u00a30-fix are precisely the high-risk spots the second check exists to catch.' },
            { text: 'You ask the warehouse to confirm your Linnworks entries', correct: false, fb: 'They cannot see or verify your data entries \u2014 the second check is an office one.' },
          ] },
        { type: 'free_text',
          prompt: 'In your own words: a junior asks why they cannot just change the PO quantity to match what the warehouse actually counted \u2014 \u2018it makes everything reconcile.\u2019 What do you tell them?',
          model_answer: 'The PO is what we paid for, so it is the evidence of what the supplier owes us. Edit it down to match a short delivery and you destroy that evidence \u2014 the shortfall disappears, no claim gets raised, and we eat the loss. The correct move is always: record the actual figure, leave the PO as the paid truth, and escalate the difference so it can be claimed. Reconciliation is not the goal \u2014 an accurate, honest record is, and a visible discrepancy is the record doing its job.',
          pass_criteria: 'Must say the PO represents what we paid / is owed; editing it hides the shortfall and loses the supplier claim; correct action is record actual + escalate; an honest record beats a tidy reconciliation.' },
      ],
    },
  ],
};

// ---- Knowledge Base reference items (department-scoped to logistics) ----
const stockinReference = [
  {
    department: 'logistics', type: 'flow',
    title: 'Stock-In \u2014 the flow at a glance',
    body_html:
      '<ol>' +
      '<li>Raise the PO in Linnworks <b>from the paid invoice</b> (cost on every line).</li>' +
      '<li>Send the warehouse a <b>packing list</b> a day ahead \u2014 barcode, name, pieces, boxes, cartons.</li>' +
      '<li>Warehouse unloads, counts, marks <b>actual</b> on the sheet, signs.</li>' +
      '<li>You <b>verify</b> the count and <b>authorise put-away</b>.</li>' +
      '<li>Warehouse puts away and returns the <b>delivery sheet</b> (barcode, location, quantity).</li>' +
      '<li>You <b>stock in</b> from the delivery sheet \u2014 enter barcode, location, quantity; tick <b>\u201cDeliver in purchase order\u201d</b>; key the cost if it shows \u00a30.</li>' +
      '<li>Confirm the PO is <b>fully delivered</b>; escalate anything that will not reconcile to your manager.</li>' +
      '<li>A <b>second office coordinator</b> reconfirms location, quantity and plan number.</li>' +
      '</ol>',
    config_json: { summary: 'The eight-step stock-in flow, PO to second check.' },
    verified_on: '2026-06-16',
  },
  {
    department: 'logistics', type: 'article',
    title: 'Stock-In \u2014 the non-negotiables',
    body_html:
      '<ul>' +
      '<li><b>Build the PO from the paid invoice</b> \u2014 not the proforma, chat, or packing list.</li>' +
      '<li><b>Record actual, never assumed.</b> Never edit a number to make it match the PO.</li>' +
      '<li><b>Cartons are not pieces.</b> Always state pieces; multiply-check the supplier\u2019s totals.</li>' +
      '<li><b>Tick \u201cDeliver in purchase order\u201d</b> on every line, or the receipt is not tied to the PO.</li>' +
      '<li><b>\u00a30 price \u2192 key it from the invoice.</b> Never leave a zero cost.</li>' +
      '<li><b>Stock in from the delivery sheet</b> (it has the real locations), not the packing list.</li>' +
      '<li><b>You never adjust stock yourself.</b> Discrepancies are listed and escalated to your manager for sign-off.</li>' +
      '<li><b>Returns run the identical flow</b> \u2014 PO, stock-in, delivery sheet, filed and tagged as a return.</li>' +
      '</ul>',
    config_json: { summary: 'The rules you do not break, on one card.' },
    verified_on: '2026-06-16',
  },
];


module.exports = {
  course, stockinCourse,
  courses: [course, stockinCourse],
  reference: reference.concat(stockinReference),
};

