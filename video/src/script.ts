/**
 * Voiceover + caption script. One entry per narrated line.
 *  - `at`   : second on the 3:30 timeline where the line starts
 *  - `text` : what is spoken AND shown as the lower-third caption
 *  - `tags` : eleven_v4 delivery tags sent to ElevenLabs only (never shown)
 * The narration files live in public/vo/<id>.mp3. When a file is missing (no
 * ELEVENLABS key during a test render) the caption still plays on time, silently.
 */
export type Line = { id: string; at: number; text: string; tags?: string };

export const SCRIPT: Line[] = [
  { id: "s1a", at: 2.8, tags: "[excited]", text: "This is the JJ Furniture Management System." },
  { id: "s1b", at: 6.4, tags: "[warmly]", text: "In Valencia City, custom orders used to live on paper slips, phone calls and memory. Now, every order lives in one live, shared record." },
  { id: "s2a", at: 15.9, tags: "[excited]", text: "Five portals share that one record: Owner, Staff, Craftsmen, Delivery Driver, and Customer. When anyone updates an order, everyone sees it instantly. Let's follow one order, start to finish." },
  { id: "s3a", at: 33.2, tags: "[warmly]", text: "It starts with the customer. Without an account, Andrea designs her own dining table in a live 3D preview. She can turn it, inspect every side, and compare it with a 165-centimeter figure for real scale." },
  { id: "s3b", at: 47.0, tags: "[excited]", text: "She types her exact size, picks Mahogany with a walnut stain, and the model updates instantly." },
  { id: "s3c", at: 57.6, text: "One tap sends her request. Nothing is ordered or charged until she accepts an official quotation." },
  { id: "s4a", at: 65.8, tags: "[confident]", text: "At the counter, staff work from one calm queue: four live metrics, stage filters, and a search bar." },
  { id: "s4b", at: 72.2, tags: "[excited]", text: "Andrea's request slides in live, marked as intake, before the seven production stages begin." },
  { id: "s4c", at: 79.2, text: "One click opens the order drawer: the 3D spec, the quotation, and the payments, side by side." },
  { id: "s4d", at: 87.6, text: "Staff confirm the price, and the official quotation is emailed to Andrea with a secure, single-use review link." },
  { id: "s5a", at: 98.8, tags: "[warmly]", text: "Andrea opens the email and reviews her quotation. She confirms both the specifications and the price: two explicit acceptances." },
  { id: "s5b", at: 109.4, text: "Because she's new, the system emails her a link to create her own password. No password is ever sent in plain text." },
  { id: "s5c", at: 120.8, tags: "[happy]", text: "She's in. Her order is confirmed, stage two of seven." },
  { id: "s6a", at: 130.8, tags: "[confident]", text: "Before any wood is cut, the shop needs a verified thirty percent down payment. Staff record it in the Payments and Gate tab." },
  { id: "s6b", at: 142.6, tags: "[excited]", text: "Only verified money counts. The production gate is met." },
  { id: "s6c", at: 152.6, text: "The owner releases the job, and it moves to In Production." },
  { id: "s7a", at: 160.8, tags: "[warmly]", text: "In the workshop, craftsmen use their phones. They see priorities and specs, never prices." },
  { id: "s7b", at: 169.8, tags: "[excited]", text: "When the piece is finished, the craftsman sends it for inspection, and the owner's dashboard updates live. Inspection passed: ready for delivery." },
  { id: "s8a", at: 182.8, text: "On the road, the driver starts the trip and confirms the delivery, with the cash collected." },
  { id: "s8b", at: 190.6, tags: "[happy]", text: "And Andrea sees it too: delivered. All seven stages, complete." },
  { id: "s9a", at: 199.0, tags: "[warmly]", text: "JJ Furniture Management System. One shared record, from the first sketch to the front door." },
];
