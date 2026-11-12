# Shelf: demo video script (target 2:55, hard limit 3:00)

**"I definitely planned this weeks ago."** At 11pm Dan remembers his sister's birthday is Saturday and asks Claude
for a handmade pour-over gift. Shelf can sell him beans from a roaster, and every mug is a link to some other
site. Across the bay, Mina's whole store is one Instagram caption that ends "DM to order, i'll send a paypal
invoice!". She pastes it into Shelf and goes live. The same prompt in a new chat now puts her $28 mug first.
Claude prepares a PayPal order shipped to Jiwoo, Dan taps Pay once, and the money lands in Mina's own PayPal.
Her dashboard then shows that Dan, like other shoppers, wanted a ceramic dripper.

Recording is 1080p, screen only, no face cam. Voiceover is recorded separately and laid over the footage. Talk
at a calm pace, about 2.5 words a second; each VO block fits its slot at that pace.

**Cast** (all fictional, all sandbox)
- **Dan Park**: the shopper, never on camera. A PayPal Sandbox Personal account renamed "Dan Park", so no
  "John Doe" on the PayPal page.
- **Jiwoo Park**: the recipient, only mentioned. Ship-to: Jiwoo Park, 123 Maple Ave, Portland, OR 97214.
- **Mina / Hanul Clay**: the seller. Her whole store is `demo-shop/instagram.txt`. No website in the video.
- **Morning Ridge Coffee Roasters**: a seed shop that has been on Shelf for weeks. It sells Dan beans before,
  and sits next to Mina's mug after.

---

## Pre-flight (before every take)

**Data**
1. Reset: `npx tsx --env-file=.env scripts/seed.mts --reset-demo`. It removes Hanul Clay and its orders,
   clears non-seed searches from the last 24 hours, and re-anchors the seed shops and the 7-day search history
   to now.
2. Wake both services. Render is on the free plan: a GitHub Actions job pings it every 10 minutes, but a
   sleeping instance can still take up to a minute on first load. Open https://shelf-ltfn.onrender.com and
   https://hanul-clay.onrender.com and wait until both load. Then open `/api/health` and check it says ok.
3. Check the "before" result with one read-only `search_products` call for "pour-over coffee gift handmade
   mug" (curl or `scripts/test-mcp.mts`). Expect Morning Ridge beans and no Hanul Clay. The next reset clears
   the logged row.
4. Rehearsal only (no DB writes): `npx tsx --env-file=.env scripts/test-import.mts --text "$(cat demo-shop/instagram.txt)"`.
   Write down the shop name, the product count, the platter's market median and the mug's gift tag. The VO
   quotes them, so they must match what's on screen.

**PayPal**
5. Recording browser profile: logged **in** to sandbox PayPal as **Dan Park**, with "stay logged in" ticked,
   after one dry approval. The approval must be one page and one tap. Never type credentials on camera.
6. Second browser profile: logged in to sandbox.paypal.com as the seller account (`SELLER_PAYPAL_EMAIL`),
   parked on **Activity**. Seed shops share this payee, so the shot crops to the newest row.
7. Have the seller sandbox email ready to paste into the Publish panel.

**Claude Desktop**
8. The Shelf connector (`https://shelf-ltfn.onrender.com/api/mcp`) is added and enabled, every Shelf tool set to
   **Always allow** (no permission pop-ups on camera).
9. Zoom 125 to 150%, sidebar hidden, a **new chat** for each of the two searches.

**Clipboard manager** (paste, don't type; the two search prompts must be character-identical)
- Search prompt (used twice):
  > Use Shelf. My sister Jiwoo's birthday is Saturday and I have nothing. She just got really into pour-over
  > coffee. Something handmade from a small studio, a mug or a dripper, under $40, that I can buy right here?
- Buy prompt:
  > That's the one. Ship it straight to her: Jiwoo Park, 123 Maple Ave, Portland, OR 97214. Gift note: "Happy
  > birthday! I definitely planned this weeks ago. —Dan"
- Check prompt: `Did it go through?`

Start the search prompt with "Use Shelf". Without it, Claude Desktop sometimes answers from its own web search
and never calls the connector.

**Windows and tabs**
10. TextEdit, full screen, 24pt, showing `demo-shop/instagram.txt` exactly as committed.
11. Browser tabs: `/sell`, and `/llms.txt` pre-opened. Hide bookmarks and notifications. Zoom 110%.
12. Start a screen stopwatch for the "Mina's setup · real time" overlay (or note the wall clock at paste and at
    "Live.").

---

## Shot list

| # | Time | Screen | Action | VO |
|---|---|---|---|---|
| 1 | 0:00–0:05 | Mina's dashboard, Orders grid. The row flashes paid; event line "Paid $28.00 for Speckled Mug, via Claude." Corner label "fictional shop · PayPal Sandbox". | Editing only: reuse the shot 11 footage. Hard cut, no title card. | This is Mina's first sale made by an AI assistant. She sells from one Instagram caption. |
| 2 | 0:05–0:22 | Claude Desktop, new chat. Label "11:04 pm · earlier that night". Reply shows Morning Ridge beans as buyable on Shelf, then Channel3 link-outs. Hold 2s on the line that mugs must be bought on other sites. Labels "link-outs via Channel3", "sped up" over the latency cut. | Paste the search prompt. | Eleven p.m. Dan just remembered his sister's birthday. He has Shelf connected in Claude, like any shopping app. Claude can sell him beans from a roaster on Shelf. Jiwoo has beans. Every mug is a link to some other site. |
| 3 | 0:22–0:37 | TextEdit: the caption. Push in (in post) on "batch 14 is OUT of the kiln!!", "speckled mug 28 (the everyday one, big coffee size)", "DM for price", "DM to order, i'll send a paypal invoice!". | No clicks. | Across the bay, Mina just pulled batch fourteen out of her garage kiln. This caption is her whole store: DM to order, she sends an invoice. Big platforms are wiring their catalogs into AI. Mina doesn't have a catalog. |
| 4 | 0:37–0:54 | `/sell`. Stopwatch starts at "Mina's setup · real time 0:00". Progress lines: "Reading your shop…", "Writing agent-ready details…", "Checking market prices with Channel3… 3 of 6". | In TextEdit Cmd-A, Cmd-C. In `/sell` click "Paste a caption or list", Cmd-V, Import. Cut the wait under "sped up"; the clock keeps true time and jumps. | So she pastes that caption into Shelf. Claude turns it into real listings, with sizes, care, and who each piece is a gift for. Channel3 checks what similar pieces sell for. |
| 5 | 0:54–1:08 | AG Grid catalog editor, indigo AI cells. Zoom (in post) on the Speckled Mug's tags cell with the gift tag. Then the Serving Platter: indigo price from the Channel3 median, market column "Channel3 $… – $…, median $…". | Double-click the platter price, type the median rounded up to the next $5, Enter. The indigo clears on that cell. | Everything Claude wrote is highlighted for her to check. She never wrote "gift for coffee lovers". Claude did, because that's how people ask. The platter said DM for price, so Channel3 suggested one. She rounds it up. |
| 6 | 1:08–1:15 | Publish panel, then the Live band: "Live." with the accent rule drawing in. Stopwatch freezes at the real figure for 2s. | Paste the seller sandbox email. Click "Publish to Shelf". Off camera, Cmd-click "Open dashboard" into a background tab. | Her PayPal email. Publish. `<M:SS>`. Nobody installs anything. (Say the measured number.) |
| 7 | 1:15–1:27 | 1.5s on "Your agent-ready page" with the `/s/hanul-clay` URL and Copy. 4s on `/s/hanul-clay`. 3s on view-source at `"@type": "Product"` and `"offers"`. 3s on `/llms.txt` at "### Hanul Clay". | Click Copy. Cmd-click the URL. Cmd-Opt-U, Cmd-F "offers". Switch to the `/llms.txt` tab, Cmd-F "Hanul". | And she gets a shop page for her Instagram bio, written for machines. Any AI reading the web sees her prices, her stock, and how to buy. |
| 8 | 1:27–1:43 | Claude Desktop, **new** chat, label "same prompt, new chat". Reply leads with Hanul Clay's Speckled Mug, $28, buyable here, Morning Ridge next to it, Channel3 last. Expand the `search_products` chip for 1.5s: "INDEPENDENT SHOPS ON SHELF — buyable here with PayPal" and "Hanul Clay joined Shelf N minutes ago". | Paste the identical search prompt. Jump-cut the latency ("sped up"). If another item leads, retake in a fresh chat. Never steer Claude on camera. | Same question, new chat. Now Mina's mug comes first, right next to the roaster, and Claude can buy it here. She joined Shelf minutes ago. |
| 9 | 1:43–2:07 | Claude's `create_checkout` reply with the PayPal link. PayPal Sandbox, already logged in as Dan Park. Hold 3s on "Shelf · Hanul Clay", Speckled Mug $28.00 and ship-to "Jiwoo Park, 123 Maple Ave, Portland, OR 97214". One tap on Pay. Then `/paid`: "Payment approved. You can go back to your assistant." 2s lower third: "PayPal Orders v2 · payee = Mina's PayPal · ship-to set by the agent · PayPal Server SDK (APIMatic)". | Paste the buy prompt. Click the link, tap Pay once. If a login form appears, stop, log in off camera, retake from the buy prompt. | Claude did the searching and the paperwork, shipping address included. Dan does one thing: checks it on PayPal and taps Pay. Mina is the payee, so the money goes straight to her. |
| 10 | 2:07–2:12 | Claude: `check_order` reads paid, $28.00, Hanul Clay, shipping to Jiwoo Park, plus the gift note. | Type "Did it go through?". | Claude checks with PayPal. Paid. |
| 11 | 2:12–2:18 | Seller profile, sandbox.paypal.com Activity, cropped to the newest row: payment received, $28.00, from Dan Park. | Switch to the tab, refresh once. If Activity lags, record it after shot 12 and reorder in the edit. | That's Mina's own PayPal. No invoice, no DMs. Shelf never touched the money. |
| 12 | 2:18–2:42 | Dashboard tab from shot 6. Row flashes, event line "Paid $28.00 for Speckled Mug, via Claude." Zoom (in post) on assistant "Claude" and the "What they asked" cell with "pour-over". Scroll to Agent demand under "Includes sample search history": dripper rows with nothing on Shelf. "Analyze demand", jump-cut, hold 4s on the dripper insight. | Switch tabs, let the 2-second poll flash land. Scroll. Click "Analyze demand". | Her dashboard updates the moment PayPal confirms: the sale, which assistant made it, and what Dan asked for. Dan wanted a dripper too. Mina doesn't make one, and neither does anyone on Shelf. People keep asking. |
| 13 | 2:42–2:55 | 2s on the caption, "restock this friday" highlighted (in post). End card on #FAF8F4, ink, no icons: "Shelf". "Agentic commerce is being built for sellers with catalogs. Shelf is for the ones who sell from a caption." "Caption to live: `<M:SS>`". "shelf-ltfn.onrender.com/try". Mono 12px muted: "PayPal Orders v2 · payee routing · agent-set shipping · verified webhooks · PayPal Server SDK (APIMatic) · Channel3 search + price comps · AG Grid ×3 · Render web + static + Postgres · Claude via MCP". Footnote "Hanul Clay is fictional. PayPal Sandbox." | Static card, lines fade in. | Batch fifteen goes in the kiln Friday. Now she knows what to make. Shelf: for the sellers who sell from a caption. |

Total 2:55, 5 seconds of slack. If it runs long, cut the view-source hold from 3s to 1.5s first, then the
caption push-in by 2s.

**Editing assets** (ink on #FAF8F4, mono or the site display font, no boxes, no icons): the stopwatch "Mina's
setup · real time", labels "11:04 pm · earlier that night", "same prompt, new chat", "sped up", "link-outs via
Channel3", "fictional shop · PayPal Sandbox", the payee lower third, the end card.

---

## On-camera risks and fallbacks

- **No beans in the "before" shot.** If Claude's query drops "coffee", Morning Ridge may not show and "Jiwoo has
  beans" won't match. Dry-run the exact prompt after reset (pre-flight 3). If no beans, change the VO to "Shelf
  doesn't have a single potter yet." Also check no other seed item (the Slow Thread tea towel) shows as a match.
- **Wrong item leads the "after" shot** (Espresso Cups or Celadon Cup). Retake in a new chat. Don't steer.
- **Caption import varies.** Sonnet may name the shop "Hanul Clay Ceramics", price the platter, or merge items.
  Fix the name in the review form on camera. If products merge or go missing, import
  https://hanul-clay.onrender.com via "Shop link" instead and change the shot 3 VO to "Her link-in-bio page
  says DM to order." Never fake the grid.
- **No images.** A caption import has no photos, so the grid's image column is empty and `/s/hanul-clay` shows
  text rows. Check it in the rehearsal.
- **Ship-to rejected.** If PayPal doesn't show Jiwoo's address, use the buy prompt "That's the one. Ship it to
  me, I'm seeing her Saturday." and drop "shipping address included" from the VO. Never show John Doe.
- **PayPal asks for a login** despite "stay logged in": stop, log in off camera, retake from the buy prompt.
- **Seller Activity lags.** Record it after the dashboard and reorder in the edit (same real payment). Only claim
  "$28.00 received"; don't promise "Shelf · Hanul Clay" text appears there.
- **"What they asked" holds Claude's search query**, not Dan's sentence. The VO says "what Dan asked for", not a
  quote. Check the cell contains "pour-over" before zooming.
- **Analyze demand leads with speckled bowls** (Haiku decides). Hold on whichever insight names the dripper. If
  none does, end the shot 12 VO with "People keep asking for speckled bowls."
- **Webhook is late.** The return-URL capture already marks the order paid, so the dashboard shows it on its next
  2-second poll. The webhook is the backup path, which is why the VO says "the moment PayPal confirms".
- **Cold start mid-take.** Free Render plan: wake both services right before recording (pre-flight 2), and don't
  pause more than a few minutes between shots.
- **Numbers must be real.** The stopwatch freeze, the spoken time and the end card use the measured figure.
  Never say "two minutes ago"; let "joined Shelf N minutes ago" speak for itself.
- Claude may mention sandbox or a test payment. Leave it in. The VO never says "real money".
- Never say retailer names aloud. The screen shows whatever Channel3 returns.
- **Re-recording**: run `--reset-demo` and start new Claude chats.

### Fallback recording path: `/try`

If Claude Desktop misbehaves (skips the connector, pop-ups, crashes), record shots 4 to 12 on
https://shelf-ltfn.onrender.com/try instead. It's the whole flow on one page: paste the caption, Import, Publish
(a shop private to that browser session), then an in-page Claude connected to Shelf over MCP through the Claude
API MCP connector, then PayPal Sandbox approval with the test buyer shown on the page, then the seller's orders
grid flashing paid.

Changes when recording on `/try`:
- Shot 2 and shot 8 use the in-page chat instead of Claude Desktop. Paste the same search prompt; the "same
  prompt, new chat" beat becomes "same prompt, before and after publish".
- The dashboard in shot 12 is the orders grid on the same page. Keep the VO.
- The PayPal page and shot 11 (seller Activity) are unchanged.
- The VO line "He has Shelf connected in Claude, like any shopping app" still holds: the in-page Claude reaches
  Shelf over the same MCP endpoint.

---

## After the final take

Leave Hanul Clay **published** on the hosted instance and don't run `--reset-demo` again. Judges testing from
Claude Desktop ask "Use Shelf to find me a speckled mug…" and need a buyable result. (`/try` publishes its own
per-session copy, so it doesn't depend on this.)

## Honesty notes (keep the video defensible)

- Hanul Clay and Mina are fictional; the shop page and the end card say so. The other shops on Shelf are seeded
  demo data, and the Agent demand grid is labeled "Includes sample search history".
- PayPal is the sandbox, with no real money.
- Sped-up waits are labeled on screen; the stopwatch shows true elapsed time.
- The opening is accurate: without a Shelf shop that matches, Claude can only link out to other sites.
