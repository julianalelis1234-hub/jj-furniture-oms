import type { Line } from "../script";

/** 60-second ad narration (files: public/vo/ad-<id>.mp3). Same voice as the pitch, punchier delivery. */
export const AD_SCRIPT: Line[] = [
  { id: "a1", at: 0.5, tags: "[excited]", text: "Meet the JJ Furniture Management System." },
  { id: "a2", at: 5.2, tags: "[excited]", text: "One live record for the owner, staff, craftsmen, drivers, and customers." },
  { id: "a3", at: 10.4, tags: "[excited]", text: "Customers design their furniture in 3D and request a quote in seconds." },
  { id: "a4", at: 20.9, tags: "[confident]", text: "Staff see it instantly, and send an official quotation." },
  { id: "a5", at: 27.6, tags: "[happy]", text: "Customers accept online and create their own secure login." },
  { id: "a6", at: 34.3, tags: "[confident]", text: "No wood is cut until thirty percent is verified." },
  { id: "a7", at: 38.3, text: "Then the owner releases the job." },
  { id: "a8", at: 41.0, tags: "[excited]", text: "Craftsmen update from their phones, and the owner sees it live." },
  { id: "a9", at: 47.3, tags: "[excited]", text: "Delivered, paid, and tracked: all seven stages." },
  { id: "a10", at: 53.9, tags: "[warmly]", text: "JJ Furniture. One shared record, from first sketch to front door." },
];
