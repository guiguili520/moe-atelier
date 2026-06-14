import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('platforms/wechat-miniprogram');
const readJson = (file) => {
  const target = path.join(root, file);
  return JSON.parse(fs.readFileSync(target, 'utf8'));
};

const assertFile = (file) => {
  const target = path.join(root, file);
  if (!fs.existsSync(target)) {
    throw new Error(`Missing ${file}`);
  }
};

readJson('project.config.json');
const app = readJson('app.json');
assertFile('app.js');
assertFile('app.wxss');
assertFile('sitemap.json');

if (!Array.isArray(app.pages) || app.pages.length === 0) {
  throw new Error('app.json pages must not be empty');
}

app.pages.forEach((page) => {
  ['js', 'json', 'wxml', 'wxss'].forEach((ext) => {
    assertFile(`${page}.${ext}`);
  });
});

console.log(`WeChat miniprogram ok: ${app.pages.length} page(s).`);
