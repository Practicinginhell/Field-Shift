# Field Shift: demo video script

For the person recording the demo. Two cuts: **3 minutes** (local judging, the team's
own story) and **30 seconds** (in case the submission form limits the video; check the
2026 rules: **[TODO]** confirm the allowed length and format).

**Before recording:**
- Run `./scripts/dev` and open http://localhost:5173 at a window size of about 1400 px.
- Analyze the three example fields once, so every answer comes from the cache in about
  a second (a live service can be slow on the day).
- Numbers below are live results from 2026-11-14. If one changes, say the new one;
  never read out a number the screen doesn't show.

## 3-minute cut

| Time | Screen | Say |
| --- | --- | --- |
| 0:00–0:25 | The map, Iowa example selected | "This is a corn–soybean field in Iowa. Over the last ten years it got 4% less rain and summers ran 0.7 °C warmer than the decade before. The farmer has to decide what to plant for the next several years. Field Shift puts 20 years of NASA data about this exact field behind that decision." |
| 0:25–0:45 | Click "Ottawa-area example", then "Fill from past crop maps"; six years fill in | "You start by clicking your field. The tool reads what was grown there from satellite crop maps: the USDA map in the U.S., Agriculture and Agri-Food Canada's in Canada. Here, near Ottawa: spring wheat, then corn and soybeans. The farmer confirms or corrects it." (A click elsewhere on the map reads that spot instead; the example's point is the verified one.) |
| 0:45–1:00 | Section 3: move "Reduce erosion" to 5, "Save water" to 4 | "Then: what matters to you. This farmer cares most about erosion and water." |
| 1:00–1:30 | Click Compare; conditions appear | "NASA POWER gives us the field's climate: rain against evaporation demand month by month, frost dates, heavy-rain days. And the Canadian soil map gives the soil: a loam with about 3.6% organic matter." |
| 1:30–2:05 | The 3D season view playing; pause on a spring month | "Here are the farmer's rotation and an option, side by side, through the seasons. Rain falls as much as it really does. When soil is bare in a heavy-rain month, a warning appears. The option keeps a rye cover over winter, so its soil is covered when the spring rains come." |
| 2:05–2:35 | Scroll to one option's card: why, evidence, gaps, check locally | "Every option says why it was suggested, which data each number comes from, what we don't know, and what to check locally. Here: erosion risk from slope is unknown, because the Canadian soil map has no slope, and the tool says so instead of guessing." |
| 2:35–2:50 | Nevada example, untick "irrigated", Compare, open "Options ruled out" | "And it rules out what can't work, with the reason. Without irrigation in Nevada, corn would get only 23% of the water it uses." |
| 2:50–3:00 | Back to the comparison | "Field Shift doesn't decide for the farmer. It shows what 20 years of data say about their own field, so they and their advisor can decide with evidence." |

## 30-second cut

| Time | Screen | Say |
| --- | --- | --- |
| 0:00–0:08 | "Ottawa-area example", then "Fill from past crop maps" | "Click your field. Field Shift reads its past crops from satellite crop maps." |
| 0:08–0:18 | Compare; 3D season view playing | "Twenty years of NASA climate data and the local soil map show where your rotation leaves soil bare in heavy-rain months, and which options do better." |
| 0:18–0:30 | One option card: evidence, gaps, check locally | "Every option shows its evidence, what we don't know, and what to check locally. It supports the farmer's decision; it doesn't make it." |
