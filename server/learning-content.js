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

module.exports = { course, reference };
