# Shelf: demo video script (target 2:50, hard limit 3:00)

The story in one line: **an assistant can find a small shop but can't buy from it. Two minutes later, it can.**

Recording is 1080p and the screen only, with no face cam. Voiceover is recorded separately and laid over the
footage. Talk at a calm pace, about 2.5 words a second; each VO block below fits its slot at that pace.

---

## Pre-flight (do this before every take)

1. `npx tsx --env-file=.env scripts/seed.mts --reset-demo`: removes Hanul Clay and its orders, re-anchors the
   seed shops and the 7-day search history to now.
2. Open `<HOSTED_URL>` once and wait for it to load. The free Render instance sleeps when idle, and the first
   request is slow.
3. Open `<DEMO_SHOP_URL>` (the Hanul Clay static site) once, for the same reason.
4. Claude Desktop: the Shelf connector (`<HOSTED_URL>/api/mcp`) is added and enabled. Start a **new chat**.
5. Browser: logged **out** of PayPal sandbox, in a fresh profile or private window. Have the sandbox buyer
   login ready to paste.
6. Have the sandbox seller PayPal email ready to paste into `/sell`.
7. Window layout: Claude Desktop on the left, browser on the right, or full-screen switching. Hide bookmarks and
   notifications. Zoom the browser to 110%.
8. Do one dry run of the opening search. It also logs a real unmet "speckled mug" search for the demand grid.
   Then `--reset-demo` again.

---

## Shot list

### 1. Cold open: the gap (0:00 to 0:18)

**Screen:** Claude Desktop, new chat. Type:
> Find me a speckled mug from a small studio, under $40. I want to buy it as a gift.

Claude calls `search_products`. No Shelf results yet; it shows market results from Channel3, each a link to
another site. Hold on Claude's reply where it says you'll need to buy on the retailer's site.

**VO:**
> People are starting to shop through AI assistants. Ask for a handmade mug, and you get links out. The assistant
> can find small shops, but it can't buy from them.

### 2. Meet the seller (0:18 to 0:30)

**Screen:** Browser on the Hanul Clay site. Slow scroll: hero, the six pieces, the platter with "ask me" for a
price, then the FAQ ("send me a message... I'll send you an invoice").

**VO:**
> This is Hanul Clay, a one-person pottery studio. A real shop, a nice site, and "DM to order". No feed, no API,
> nothing an assistant can check out from.

### 3. Import (0:30 to 0:55)

**Screen:** `<HOSTED_URL>/sell`. Paste `<DEMO_SHOP_URL>`, press Import. The progress lines follow the server's
real steps: "Reading your shop…", "Writing agent-ready details…", then "Checking market prices with Channel3…"
with a live count ("3 of 6"). Every line shows for at least a moment, even on a fast run. Cut the wait and put a
small "sped up" label in the corner.

**VO:**
> Mina pastes her shop link into Shelf. Claude reads the page and pulls out every product. Then it writes the
> details agents need, like material, size, care and gift tags, and Channel3 checks market prices.

### 4. Review in the grid (0:55 to 1:15)

**Screen:** AG Grid catalog editor. Point at the subtly highlighted "AI" cells: tags, attributes, care. Point at
the market column ("Channel3 $… – $…, median $…"). Point at the Serving Platter: its price came from the market
median. Edit one cell, the platter price (round it), and show the AI marker clear.

**VO:**
> Everything the AI wrote is highlighted, so she knows exactly what to check. The platter had no price, so Shelf
> suggested one from the market. She adjusts it, and that cell is hers now.

### 5. Publish (1:15 to 1:25)

**Screen:** Type the sandbox seller PayPal email. Press "Publish to Shelf". Hold on the success line: "Live. Any
assistant connected to Shelf can find and buy from Hanul Clay now." Then click "Open dashboard" (off camera is
fine) and **leave that tab open** through shots 6 to 8. It shows "No orders yet"; the order arrives there live.

**VO:**
> She adds her PayPal email and publishes. That's the whole setup.

### 6. Same question, new answer (1:25 to 1:45)

**Screen:** Back to the same Claude chat. Type:
> Try again. Anything from a small studio I can buy right here?

Claude's `search_products` result now leads with Hanul Clay's Speckled Mug, $28, marked buyable in chat, with the
tool note "Hanul Clay joined Shelf just now" (or "N minutes ago"), and market links below it. Claude may call
`get_product`; let it.

**VO:**
> Same question in Claude. Now Hanul Clay comes first, published a minute ago and buyable right here in the
> chat.

### 7. Buy it in chat (1:45 to 2:12)

**Screen:** Type:
> Buy the speckled mug. Gift note: "Happy birthday, Jiwoo". Ship to Jiwoo Park.

Claude calls `create_checkout` and shows the PayPal link. Click it. PayPal sandbox: log in as the buyer, show
"Shelf · Hanul Clay" and $28.00, press the pay button. Land on Shelf's "Payment approved. You can go back to your
assistant."

**VO:**
> Claude creates a PayPal order with Hanul Clay as the payee, so the money goes straight to Mina. The buyer
> approves on PayPal, as always. The assistant never pays on its own.

### 8. Confirmation (2:12 to 2:20)

**Screen:** Back in Claude. Type "Did it go through?". Claude calls `check_order`: paid, $28.00, Hanul Clay.

**VO:**
> Claude checks the order. Paid.

### 9. The seller's side (2:20 to 2:40)

**Screen:** Switch to the dashboard tab opened in shot 5. The Orders grid row flashes as paid and the line "Paid
$28.00 for Speckled Mug, via Claude." appears, with assistant "Claude" and the shopper's question in the "what
they asked" column. (If the tab was closed, opening `/dash/[id]` within 3 minutes of the payment still flashes
the row and shows the line.) Scroll to Agent demand: last week's searches like "speckled
bowl" and "celadon cup". Press "Analyze demand" and show the first insight.

**VO:**
> Mina's dashboard updates the moment the payment lands. She sees which assistant sold the mug and what the
> shopper asked for. She also sees what agents searched for that she doesn't sell yet.

### 10. Close (2:40 to 2:52)

**Screen:** Shelf landing page with the "Connect Shelf to Claude" MCP URL visible. End card: "Shelf. Small shops,
buyable by AI." with the hosted URL, then small text: PayPal Orders v2 + webhooks (APIMatic SDK) · AG Grid ·
Channel3 · Render · Claude.

**VO:**
> Shelf makes any small shop buyable by AI assistants in two minutes. Shoppers connect once, and sellers never
> install anything.

---

## Timing check

| # | Segment | Start | End | Length |
|---|---|---|---|---|
| 1 | Cold open | 0:00 | 0:18 | 18s |
| 2 | Seller site | 0:18 | 0:30 | 12s |
| 3 | Import | 0:30 | 0:55 | 25s |
| 4 | Grid review | 0:55 | 1:15 | 20s |
| 5 | Publish | 1:15 | 1:25 | 10s |
| 6 | Search again | 1:25 | 1:45 | 20s |
| 7 | Buy | 1:45 | 2:12 | 27s |
| 8 | Paid | 2:12 | 2:20 | 8s |
| 9 | Dashboard | 2:20 | 2:40 | 20s |
| 10 | Close | 2:40 | 2:52 | 12s |

Total 2:52, with 8 seconds of slack under the 3:00 limit.

## If something goes wrong on camera

- **Import is slow**: keep recording and cut it in editing. Never fake the result; the grid must be the real
  import.
- **Claude doesn't pick Hanul Clay first**: re-ask with "something I can buy here in the chat". Shelf hits are
  listed before market results in the tool output.
- **Webhook is late**: the return-URL capture already marked the order paid, so the dashboard still shows it on
  its next 2-second poll. The webhook is the backup path; the voiceover says "the payment lands" for that reason.
- **Re-recording**: run `scripts/seed.mts --reset-demo` and start a new Claude chat.

## After the final take

Leave Hanul Clay **published** on the hosted instance. The judges' testing instructions in `SUBMISSION.md` ask
Claude for a speckled mug, and they need a buyable Shelf result. Don't run `--reset-demo` again after
submitting.

## Honesty notes (keep the video defensible)

- Hanul Clay and Mina are fictional; the site footer says so. The other shops on Shelf are seeded demo data.
- PayPal is the sandbox, with no real money.
- Label sped-up waits on screen.
- The opening is accurate: without Shelf, Claude finds independent shops only as links out of the chat.
