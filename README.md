# dsh-browser-suite

**DSH 娴忚鍣ㄥ浠?*锛氭妸鏈湴娴忚鍣ㄦ悳绱?鎶撳彇銆佽緭鍏ユ鏈湴/API 鍒囨崲銆佺綉椤电増 DeepSeek 妗ユ帴鍚堝苟鎴愪竴涓?DSH 鎻掍欢銆?
鏈寘鐢ㄤ簬鏇夸唬浠ヤ笅涓変釜鏃ф彃浠讹細

- `dsh-local-browser-search`
- `dsh-local-web-control`
- `dsh-webds-bridge`

> English summary is at the end of this README.

---

## 鍔熻兘

### 鏈湴娴忚鍣ㄦ悳绱?
- `browser_search`锛氶€氳繃鏈満 Edge/Chrome 鐨?CDP 鎵ц缃戦〉鎼滅储锛屼笉闇€瑕佹湇鍔＄鎼滅储 API Key銆?- `browser_fetch`锛氭墦寮€鎸囧畾 URL 骞惰繑鍥炴覆鏌撳悗鐨勬鏂囥€?- 鏀寔 Bing銆佺櫨搴︺€佹悳鐙椼€丏uckDuckGo銆丟oogle銆?- 杈撳叆妗嗕腑鐨勩€屾湰鍦版悳绱€嶅紑鍏虫帶鍒舵湰鍦版悳绱?API 鎼滅储浜掓枼銆?- 閰嶇疆鑷姩淇濆瓨鍒?`$DSH_HOME/local-web-control.json`銆?
### 缃戦〉鐗?DeepSeek 妗ユ帴

- 绾?DOM 鑷姩鍖栵紝鏃犻渶 DeepSeek API Key銆?- 鏀寔涓ょ杩愯浣嶇疆锛?  - **渚ц竟鏍?Browser tab**锛氫娇鐢?DSH 鍙充晶鏍忔祻瑙堝櫒銆?  - **鐙珛娴忚鍣?*锛氶€氳繃 CDP 椹卞姩鏈満 Edge/Chrome锛屽彲鏃犲ご鎴栨樉绀虹獥鍙ｏ紝鎸佷箙鍖栫櫥褰?profile銆?- 鎵嬪姩妗ユ帴娴佺▼锛氬湪缃戦〉鐗堣璁猴紝鐒跺悗浣跨敤銆屽瓨璁板繂 / 鎵ц / 缁帴銆嶃€?- 閰嶇疆鑷姩淇濆瓨鍒?`$DSH_HOME/dsh_memory/config.json`銆?
### 鍚堝苟鍚庣殑杈撳叆妗嗙晫闈?
- 銆屾湰鍦版悳绱€嶅紑鍏筹紙鏉ヨ嚜 `dsh-local-web-control`锛夈€?- 銆岀綉椤电増銆嶉厤缃寜閽紙鏉ヨ嚜 `dsh-webds-bridge`锛夈€?- 浼氳瘽鏍囬鏍忕殑瀛樿蹇?鎵ц/缁帴鎸夐挳銆?- 璁剧疆椤电殑缃戦〉鐗堟ˉ鎺ラ潰鏉裤€?
## 瀹夎

```bash
dsh plugin --profile desktop add github:User-Clb/dsh-browser-suite
```

鏈湴寮€鍙戯細

```bash
git clone https://github.com/User-Clb/dsh-browser-suite.git
dsh plugin --profile desktop add link:<absolute-path>/dsh-browser-suite
```

瀹夎鍚庝粠鎵樼洏瀹屽叏閫€鍑?DSH 鍐嶅惎鍔ㄣ€?
## 閰嶇疆璺緞

- 鏈湴鎼滅储锛歚$DSH_HOME/local-web-control.json`
- 缃戦〉鐗堟ˉ鎺ワ細`$DSH_HOME/dsh_memory/config.json`
- 鐙珛娴忚鍣ㄩ粯璁?profile锛歚$DSH_HOME/dsh_webds_browser`

## 寮€鍙戞鏌?
```bash
node --check index.js
node --check client.cjs
node --check lib/control/index.js
node --check lib/webds/index.js
node --check lib/webds/standalone.js
```

## 鏋舵瀯

```text
index.js                 Host 缁勫悎鍏ュ彛锛歝ontrol.apply(ctx) + webds.apply(ctx)
client.cjs               Client 缁勫悎鍏ュ彛锛氫袱浠借緭鍏ユ UI 涓€璧?apply
lib/control/             鏈湴娴忚鍣ㄦ悳绱?鎶撳彇 + 鏈湴/API guard
lib/webds/               缃戦〉鐗?DeepSeek 鎵嬪姩妗ユ帴
cordis.patch.yml         Host + Client 涓ゆ潯 loader 鏉＄洰
```

## 宸茬煡杈圭晫

- 缃戦〉鐗堟ˉ鎺ヤ緷璧?DeepSeek 椤甸潰 DOM锛岄〉闈㈡敼鐗堟椂闇€瑕佹洿鏂伴€夋嫨鍣ㄣ€?- 鐙珛娴忚鍣ㄩ渶瑕佹湰鏈哄畨瑁?Edge/Chrome锛涢娆＄櫥褰曢渶鍦ㄧ嫭绔嬫祻瑙堝櫒閲屽畬鎴愩€?- 褰撳墠鍚堝苟鐗堟槸**鎵嬪姩妗ユ帴**鐗堟湰锛涜嚜鍔ㄥ璇濇簮/妯″瀷璺敱涓嶅湪鏈悎骞剁増鑼冨洿鍐咃紝閬垮厤褰卞搷 DSH 鏈綋绋冲畾鎬с€?
---

## English summary

`dsh-browser-suite` merges three MIT-licensed DSH plugins:

- local Edge/Chrome web search and fetch (`browser_search` / `browser_fetch`);
- the composer's local-vs-API search switch and guard;
- the DOM-automated web DeepSeek manual bridge (sidebar or standalone browser).

Install:

```bash
dsh plugin --profile desktop add github:User-Clb/dsh-browser-suite
```

Config:

- local search: `$DSH_HOME/local-web-control.json`
- web bridge: `$DSH_HOME/dsh_memory/config.json`

This merged release is **manual bridge only**; the automatic model-source experiment is intentionally excluded to keep the DSH host stable.

## Credits

This package merges and rearranges MIT-licensed code from:

- `dsh-local-browser-search` 鈥?local browser search/fetch driver family.
- `dsh-local-web-control` 鈥?in-composer local/API control and guard.
- `dsh-webds-bridge` 鈥?web DeepSeek DOM bridge.

## License

MIT
