# Competitor leaderboard — Meta Global AI Developer Hackathon

Sourced from the `#intros` channel: **1,733 messages** (full-history export
`fixtures/intros-discord-20261031-1031.json`, pulled 2026-10-31) plus the
30-message partial `fixtures/intros-discord-20261031-1021.json`.
Rankings use community reactions as the interest signal; project details are
quoted or paraphrased strictly from what each builder posted. Nothing here is
scraped from outside the channel.

- Pitch-pattern matches in the full export: ~250 (incl. "I am building" variants)
- With a named project or repo link: ~158
- With ≥2 reactions: 41
- Named projects catalogued below: ~70

## ⚠️ Watch list — closest to SnapClaim (photo in → measurement/assessment out)

| # | Project | Builder | Why it matters | Signal |
|---|---|---|---|---|
| 1 | **Snapdesk** | Ruthwik (Ruth), solo, India | Customer sends a **photo of a damaged item** → SAM 3.1 **finds the damage and measures it** → Spark reads shop policy → refund / replace / repair / human. Ends with marked-up photo + measurements + decision + policy line. Same damage-measure-decide loop as SnapClaim. | 1 react |
| 2 | **SnapPart** | Bibek Sarkar + Bhashwati Roy, Indie | Snap a broken bracket **next to a reference coin** → SAM 3.1 sub-mm contour segmentation → Spark writes CadQuery → 3D-printable STL. Coin-as-scale + measurement, same trick as our ruler/coin gate. | 0 reacts |
| 3 | **LoadMaster** | Ryan Cotten, solo Indie | Photo of a loaded trailer → SAM 3.1 segments load + trailer → Spark checks tie-downs/overhang/tarp against cargo-securement rules, in plain words. Photo→measurement→rules verdict. | 2 reacts |
| 4 | **AI Fixit** | David Ch, Georgia | Photo of something broken/damaged/poorly arranged → visual action plan. | 2 reacts |
| 5 | **Maqet** | Romeo Monfroglio, Indie (Argentina) | Snap a floor-plan photo → live redesign → AR on table → export a **measured DXF**. Plan → AR → CAD, "one source of truth". | 3 reacts |
| 6 | **Shop AI Copilot** | kscooby, Indie | Point phone at car/part → ID + pull-it-or-leave-it verdict + listing draft, from real shop photos. Photo-first vehicle assessment. | 4 reacts |
| 7 | **Topo agent** | Yuzuki Kondo, Indie (Japan), repo live | Snap wall photo + tap one hold → SAM 3.1 outlines every hold → agent picks the problem's holds. **Tap-to-mark + SAM**, 14% → 100% recall on tape-marked problems. Mechanically closest interaction to ours. | 1 react |
| 8 | **Real or Replica** | Sabastian (Card Cauldron TCG), Indie | Pokémon card fake-checker: Spark + Muse Image + SAM 3.1, multiple tells, honest limits stated (front-only, slab-cert check). Evidence-first framing. | 0 reacts |
| 9 | **SiteSense** | Barbara Ackles, Indie (Canada) | Satellite → drone → phone close-up → SAM 3.1 + Muse Wonder → severity-rated work order. Safety-first: refuses to claim what it can't see. Field-inspection pipeline. | 0 reacts |
| 10 | **Road-damage auditor** | Mateo (S3baS), Indie | Citizen road-damage reports → SAM detects hazards → before/after repair verification, PII-anonymized. | 1 react |
| 11 | **Receipt/ledger cluster** | Kraisorn (TH phone-to-ledger, offline Glimmer path); Adam (Duka Books, WhatsApp + Swahili voice); Raj (SayLedger, Startup, "maths done in code, never by the model"); Nagasai (Dukaan Saathi, SAM segments ledger rows) | Photo of receipt/ledger → structured books. Same document-measurement muscle, different artifact. | 0–2 reacts |
| 12 | **RepairLens** | Oumy Dieng, solo | Point phone at broken appliance → SAM 3.1 isolates internal components → repair guidance (visual + voice + acoustic). | 0 reacts |
| 13 | **PP-Coach-Tracker** | Jose Luis (pepemxl), Indie (Mexico) | Phone records play → SAM 3.1 tracks players/ball → homography → **real pitch in meters** → Spark tactical report. Pixels-to-metres with calibration. | 0 reacts |
| 14 | **RealityLab** | Muhammad Sameer, Indie | Scan real-world objects → exploded-view engineering blueprints + "Build Mode". SAM 3.1 + Spark + Muse Image. | 0 reacts |
| 15 | **Showfront** | Ahmad Odeh (ABUZ8), Indie | Dealer lot photos → SAM 3.1 isolates car → 360 spin + listing + commercial. Real dealer judges output. | 0 reacts |

## 🏆 Community top 10 by reactions

| Rank | Reacts | Project | Builder | One-liner |
|---|---|---|---|---|
| 1 | 8 | Trucker WhatsApp co-pilot | Pavlo (Private_profit), Startup | Voice note + **photo of rate confirmation** → Spark finds hidden fines, tracks detention, drafts broker email. |
| 2 | 5 | Health-data privacy agent | Patrick (patbpm), Indie | Open-weights, runs locally, publishes honest evals. |
| 3 | 5 | **MetaECU Copilot** | Michał (MichælG_), Indie | Verifiable ECU calibration: reads flash binaries, deterministic safety gate intercepts unsafe torque. Spark + Wonder + SAM 3.1. |
| 4 | 4 | **Shop AI Copilot** | kscooby, Indie | (see watch list) |
| 5 | 4 | **Not Alone** | Stuart (StusMethod), Indie | AI partner for POD sellers: cuts product out of photos, writes listings in your voice. |
| 6 | 4 | **Athos** | Matías (matiasmolinas), Indie | Portable AI know-how: captures how you do tasks as markdown, reuses across agents. Live demo + repo. |
| 7 | 4 | Shelter keepsake art | Logan (Dogdrool_) | SAM 3.1 IDs shelter animals in photos → donor keepsake art. |
| 8 | 4 | Compliance navigator | Doc (Docdrewbe) | Complex requirements → gaps + evidence, hospitals first. |
| 9 | 3 | **Maqet** | RomeKai, Indie | (see watch list) |
| 10 | 3 | **Burotu** | Michaël (Zoukmar), Indie | Teaching Muse Glimmer to read DNA methylation: 71% catch at 1% tumour DNA, 99.8% specificity. Live site + code. |

Also at 3 reacts: AgroGenesis (Walter, farm-manager agents), SPT-TXN (Rudi, privacy-preserving tx triage), Wrytely student agent (Murtazo/Akbar), architect review for built environment (Natasha Newbold), Hedgeling (AnnieBear).

## 📋 Directory — every named project verified from intros

| Project | Builder | Track | What it does | Reacts |
|---|---|---|---|---|
| Snapdesk | Ruthwik | — | Damage photo → measure → refund/repair decision | 1 |
| SnapPart | Bibek + Bhashwati | Indie | Photo + coin → sub-mm → printable STL | 0 |
| LoadMaster | Ryan Cotten | Indie | Trailer photo → securement check | 2 |
| AI Fixit | David Ch | — | Broken-thing photo → action plan | 2 |
| Maqet | Romeo M. | Indie | Floor-plan photo → measured DXF | 3 |
| Shop AI Copilot | kscooby | Indie | Car photo → ID + verdict + listing | 4 |
| Topo agent | Yuzuki Kondo | Indie | Wall photo + tap → hold detection | 1 |
| Real or Replica | Sabastian | Indie | Card photo → fake check, multi-tell | 0 |
| MetaECU Copilot | Michał | Indie | Verifiable ECU calibration | 5 |
| Athos | Matías | Indie | Portable agent know-how | 4 |
| Not Alone | Stuart | Indie | POD photo cutouts + listings | 4 |
| Burotu | Michaël | Indie | Methylation → cancer signal | 3 |
| AgroGenesis | Walter | — | Farm-manager agent vs humans | 3 |
| SPT-TXN | Rudi Coetzee | Startup | Privacy tx authorization layer | 3 |
| Wrytely agent | Murtazo + Akbar | — | Student "Jarvis" organizer | 3 |
| Blindspot Engine | Lori (Mabbit143) | — | Evidence-contradiction researcher | 2 |
| RadMesh AI Mode | Miguel (angaritarad) | Startup | Conversational RIS/PACS resident | 2 |
| synqdash authoring | Christopher (Emotional Damage) | Startup | NL → automation canvas on Muse | 2 |
| ExtBrain | Tingyi (Ainovo) | — | Chat-history insight extractor | 2 |
| VerbaGPT | Syed | — | NL → SQL/Python + charts, image-repro | 2 |
| Road to 5K | Benny Rodriguez | Indie | Rehab coach for Ray-Ban Display | 2 |
| BlinkFlow | Sorin (Samoxis) | Indie | Robot-failure rewind + fix + replay | 2 |
| Omni Agent | Edward Obi | Indie | Autonomous web agent, jobs first | 2 |
| Physical MCP | Pam Villalon | — | Webcam + SAM → servo presses buttons | 2 |
| Duka Books | Adam (ManFondo) | Indie | WhatsApp ledger/receipt bookkeeper | 2 |
| VibeGuard | Mayank Soni | — | Scanner for vibe-coded app flaws | 2 |
| ClassPrep Autopilot | Kevin Richards | Indie | Course → verified prep bundle | 1 |
| Carpathron | Mircea Rusu | Startup | Talk-to/drive/become robots + desktop AI | 0 |
| VirtuRide | Ferdinand (JayDadRobot) | — | Rider-safety HUD on Ray-Ban Display | 0 |
| iVibe | Niky (Nikylogic) | — | Show bug on screen → fix prompt | 0 |
| Vaultio | Emmanuel (Nuel) | Startup | Technical-hiring assessment layer | 0 |
| SiliconShield | 117iit | — | Hardware security with Meta models | 0 |
| BacktestAI | mouad | Indie | Agent writes/compiles/backtests MQS5 | 1 |
| ClipQuery | Indranil | Indie | NL search over camera footage (SAM open-vocab) | 0 |
| GridSense | Abu Maheer (htech) | Indie | Hausa/English outage assistant + photo inspect | 0 |
| Postor | Aneudys | Startup | Tender dossier → go/no-go with citations | 0 |
| SiteSense | Barbara Ackles | Indie | Inspection severity work orders | 0 |
| EmberWalk | Deacon Roswell | Indie | Wildfire home checkup | 0 |
| TEMPO | Jan (Wolv) | Indie | Time-blindness keeper agent + camera invites | 0 |
| FindIt | Dileep | — | Glasses remember where things are | 0 |
| SimForge AI | Brian Penrod | — | Simulated robot workbench | 0 |
| ConVía pickup verify | Juanda | Indie | SAM tracks car + plate read | 0 |
| Dukaan Saathi | Nagasai | Indie | Ledger photo → digitized + voice Q&A | 0 |
| SayLedger | Raj (Lexcore) | Startup | Voice + vision ledger, maths in code | 0 |
| Khet Saathi | Rafat (Royal Bengal AI) | — | Autonomous farm agent | 0 |
| Hermes (agronomic) | Franco (Kore Labs) | Startup | Weekly field-work copilot | 0 |
| PayMind Voice | Jorge (Joarciniegas) | Startup | Bilingual voice for used-car dealers | 0 |
| Medina Academy | Fathiya Yoosef | — | Teacher-prep assistant | 0 |
| Deja Vu | Vamshi Kanderao | Indie | Personal agents that remember | 0 |
| OpenLoop | Ritik Joshi | — | (agent infra — detail in thread) | 0 |
| navfail | Manju Jay | Indie | Automates a slow manual engineering step | 0 |
| Onuron OS | Joysriram Sarkar | Indie | Private open-source AI OS | 0 |
| Buzzard Code | Balaharish | — | Agent runtime: tool execution + safety | 0 |
| XMemo | Han (Yonro) | — | Memory layer for AI tools | 0 |
| PostOrca | Nika Aung | — | Social manager that reads your commits | 0 |
| AIRA Companion | Deeman (TechLabID) | — | Spatial AI companion | 0 |
| OmniGuide | Mahfoud | — | OS-level visual guidance overlay | 0 |
| Lantern | palakura | Indie | Private companion + glasses link | 1 |
| MotherTongue Books | Sahaj | — | Kids' books in mother tongue, tap-to-learn words | 0 |
| Fraction Comp | Vinay Krishna | Indie | (detail in thread) | 0 |
| Agrisense | Tracy | Indie | (teaming up solicit) | 0 |
| YourMove | Joshua | — | (detail in thread) | 0 |
| Gol | Ashish Adhikari | — | Shop-owner backend over chat | 0 |
| Wokadi | Dami (Damilare) | Indie | Invoice photos → stock records | 0 |
| Nexora | Smatt | — | Decentralized health database | 0 |
| MAVIS | Ephyni Ferreras | — | Personal productivity assistant | 0 |
| Kinaiya | Rogie (DinoBocchi) | — | Voice-agent platform, modular interaction | 0 |
| SMILE | Kristoffer (CodeSphere PH) | — | Gamified tourism landmarks | 0 |
| Mythree | Vijaya Meda | Startup | Live cross-language video interpreter | 0 |
| Orbit | Akshay (Qook) | — | Workspace (closed-beta follow-up) | 0 |
| BendLab | YASHH | — | Phototropism simulation + clustering | 0 |
| ShieldPocket | Joseph (josephmadden121) | — | Pocket CVE triage analyst | 0 |
| PocketBench | Stanescu | — | Windows repair investigator | 0 |
| Nerve.rs | Alex (digitBF) | — | Open-source controllable AI runtime | 0 |
| AONE BP | Yusuff Olufemi | — | WhatsApp salon/shop assistant | 0 |
| Quantura Studio | Tamzid (royalty) | — | Frontier-agent studio intro | 0 |
| Enheduanna | Priyanshu (M3TAM0RPH0S1S) | — | Screen-memory desktop intelligence on Muse | 0 |
| Taskflow OS | Denis (whoisladleo) | — | Enterprise ops + automation | 0 |
| ContextGuide | Tajudeen Ahmad | — | Visual aid for visually impaired | 0 |
| Playfellow | Hesham Aboul-Fetouh | — | (detail in thread) | 0 |
| Lably | Mardav (Dawn) | — | Sentence → interactive science experiment | 0 |
| RealityLab | Muhammad Sameer | Indie | Object scan → blueprints + Build Mode (see watch list) | 0 |
| Kirimin ID | Maftuh (Maff) | Startup | Business-tool platform + Meta AI | 2 |
| Anukriti AI | Abhimanyu R B | — | Drug-risk genetics tools | 2 |
| Hypa Intelligence | Chris Ibe | Startup | Multilingual speech + language models | 0 |
| mmData spatial investigator | Melissa | — | Quest 3 investigation environment | 2 |
| Nexentra | Sumedha G | — | Agentic banking platform | 2 |
| Mind (Cognitiva) | reas015 | — | Metacognitive memory agents | 2 |
| Agora | Taylor (Baltor.AI) | — | Architecture doc site, team-seeking | 0 |
| AdStatus | Hadrien (Hadi) | — | Ad-platform watcher (shipped) | 0 |
| Vee Vee | Wayne Levi | — | Instruction-core exam 89/89 on Wonder | 0 |

## 🌍 #build-for-your-world scan (1,162 messages, export `fixtures/build-for-your-world-discord-20261031-1559.json`)

Second channel pulled with the same exporter. Smaller and further along: working repos, live demos, shipped apps. Headline finding: **SnapClaim's philosophy is not unique — there is a rigor school.** Five projects independently landed on measured-vs-guessed numbers, deterministic checks, and receipts. That validates the thesis and raises the bar at once: the moat is no longer "we do evidence", it's "we do it most completely (live backend, 121 tests, human-baseline gap table)".

### The rigor school — members ranked by completeness

| Project | Builder | Their evidence practice | Ship state | Threat |
|---|---|---|---|---|
| **SproutVision: Crop Scout** | Farrah (FandomGames), Indie, solo | Quest 3 HUD: photo → SAM segments plants/tray → coverage = mask ÷ mask → Spark verdict *from the measurement*. Publishes the full triad: guessed 35% (Spark-only AND Gemini) vs measured 54/51% vs eye 70%. Golden validation commit, verdict trace w/ SHA-256, confirmation gate, cost caps, 241 tests green. | Public repo, in-headset verified | 🔴 **Highest.** Same gap-table move, same mask-math, shipped with tests. The mirror match. |
| **CourtSense** | Alperen (AlperenGT) | Tennis video → SAM tracks both players, 4-click court calibration → Spark answers from data, **checks every number against the data, marks uncertain values** (±0.1 m near, rougher far — stated). | Demo + repo, organizer-cleared | 🔴 Pixels-to-metres with stated error bands. Closest to our ruler pipeline. |
| **Quetzal AOI Briefing** | Xava | Every result labelled **measured / computed / inferred, with receipt**. Rules Adherence Agent gates every commit/demo. | Public repo, day-1 updates | 🟠 Same receipts language, different domain (seismic). |
| **Ithaca** | Halo (ALO) | "Numbers never come from the model. A deterministic engine counts every minute and every won… checked against a ground-truth checklist." | Repo live | 🟠 Deterministic-numbers doctrine, stated cleanly. |
| **QorTime** | Contravious (ConWan), first hackathon | SAM tracks screen, Spark explains, **rule-based checks make the call**. Signed receipts, public VERIFIED match page, demo + repo. "The AI only explains." | Shipped w/ demo + repo | 🟠 Referee-pattern twin. |
| **Operacija Dvina** | Marius (Mario Vilnius) | Verifier **fails the build** if any quote or number can't be sourced. 11-language TTS, grounding-first. | Try it + demo + repo | 🟡 Grounding rigor, content domain. |
| **Zero / AI's Cart** (CiteShare) | Lance Rocker | Evaluator that finds unsupported claims and preserves the evidence behind recommendations; screenshot-first shopping checks. | Building | 🟡 Evidence-verification lane. |
| **G23 Evidence Copilot** | Waravut (Thailand) | SHA-256 hash-chain verification, VALID/UNKNOWN/MISMATCH/CORRUPTED states, AI kept separate from deterministic results. | Repo | 🟡 Same church, infra domain. |
| **FieldRook** | Nullfeather | "Evidence first. AI second. Technician in control." 687 backend + 47 E2E + 66 shell tests green. | v0.5.0 shipped | 🟡 Rigor culture, Windows domain. |
| **Athos bench** | Matías | Published bench: Spark 19/20 runs right *with* know-how vs 2/20 without. | Update posted | 🟢 Numbers-against-baseline habit. Same instinct as our gap table. |
| **Montivo self-review** | Billy | Measured fault-catch: Spark alone 82% → 91% with deterministic checks (Voice + SAM); faulty cuts passing 30% → 9%. | Dev log + repo | 🟢 Measured-guardrail numbers. |

### New domain overlaps (photo → assessment)

| Project | Builder | Overlap with SnapClaim |
|---|---|---|
| **VergeCare** | Phil (Phil10xs) | Film + narrate **property repair issues** → snag list + tracker, handymen matched, bills paid. Property-damage domain, freshest post in the channel (10-31). |
| **ClimateGuard** | Khoa (Stockton), solo | Disaster damage-report **photos + checklist**; demo + repo live. Same damage-report shape. |
| **CukupAI** | Ishab, Startup | Receipt OCR via SAM 3.1 + on-device ML Kit, near-zero API cost. Receipt cluster grows. |
| **GridSense repair check** | Abu Maheer (htech), Indie | SAM + Spark **check the repair photo before closing the job**. Before/after verification. |
| **Khet Saathi** | Rafat | SAM 3.1 segments 39 plots from one satellite frame; voice-first farm decisions. |
| **CiteShare cart** | Lance Rocker | Screenshot → product/price/claim check. Adjacent inspection. |
| **Sebuh invoicing bot** | Sebuh (Mentra) | Photo of field work → invoice line item via Quickbooks MCP. Photo → billable record. |
| **KEDD Autopilot** | Efe (Türkiye), Startup | Voice note + product photos → week plan, approval-gated. Adjacent. |

### Already-shipped signals (this channel ships)

Mythree (Vijaya) has a live try-it link with voice-clone deletion guarantees; Carpathron (Mircea) is **on the Microsoft Store**; iVibe (Niky) has downloadable Mac DMGs; SarafuPay submitted with a demo; Spider Engine is open-source. The bar here is "live link or it didn't happen" — our tunnel-tested PWA + live Worker belong in the same sentence.

## Method note

- Full-history channel exports via the new API exporter (no scroll gaps): every message above is verifiable by `id` in its fixture file.
- The 1021 partial (30 latest messages at 10:21) is fully contained in the 1031 pull; nothing in it is newer than 04:04 UTC 10-31.
- Reactions are a weak signal (social posts outrank pitches) — the watch list is ranked by product overlap with SnapClaim, not by reacts.
- Track labels only where the author stated one; "—" means unstated or ambiguous.
- Next refresh: re-pull the channel and diff by message `id` (snowflakes sort chronologically).
