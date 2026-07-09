path = r'D:\Codex skill\AutoScrapeFreeNodes\scraper.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace buildDisplayName with cleaner version
old_build = '''function buildDisplayName(p) {
  const region = (p._region || "unknown").toLowerCase();
  const flag = getFlagEmoji(region);
  const base = cleanProxyName(p.name);
  const speed = p.speed || "unknown";
  const score = p.qualityScore || 0;
  return flag + base + "|" + speed + "|" + score + "分";
}'''

new_build = '''function buildDisplayName(p) {
  const region = (p._region || "unknown").toLowerCase();
  const flag = getFlagEmoji(region);
  const countryName = getCountryName(region) || region;
  const speed = p.speed || "unknown";
  const score = p.qualityScore || 0;
  return flag + countryName + "|" + speed + "|" + score + "分";
}'''

content = content.replace(old_build, new_build)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Updated buildDisplayName to use clean country names')
