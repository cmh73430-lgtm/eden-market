// 수집기용 설정 읽기 (서버 없이 쓰는 가벼운 버전). scripts/collect-auto.mjs 와 공개 저장소 eden-market 이 같이 쓴다.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { holidayIndex } from "../shared/calendar.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

export function loadCollectConfig() {
  const hol = holidayIndex(readJson("data/holidays.json"));
  return { sources: readJson("config/sources.json"), themes: readJson("config/themes.json"), holidays: hol.list, holidayNames: hol.names };
}
