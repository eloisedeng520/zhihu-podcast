#!/usr/bin/env node
import fs from 'node:fs';

const [input, output = 'generation-log.json'] = process.argv.slice(2);
if (!input) {
  console.error('用法：node scripts/export-generation-log.mjs episode.json [generation-log.json]');
  process.exit(1);
}
const episode = JSON.parse(fs.readFileSync(input, 'utf8'));
const log = (episode.generationLog || []).filter(x => ['analyzing', 'writing', 'reviewing'].includes(x.stage));
fs.writeFileSync(output, JSON.stringify(log, null, 2) + '\n');
console.log(`已导出 ${log.length} 条记录到 ${output}`);
