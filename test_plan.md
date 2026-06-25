1. **Fix the "Ghost Submit" (API Sync Bug)**
   - In `packages/mobile/src/app/count.tsx`, the `handleSubmitCount` function only queues the new counts into `collectedCounts` state and advances `currentLineIndex`. We need to submit to the API immediately so the web UI Manager Audit tab updates right away, and so if the network fails the user is warned before moving on to the next item.
   - Refactor `handleSubmitCount` to make an `await apiClient.post` call for the current item and wrap it in a `try/catch`. Only advance to the next item after a successful 200 response. The bulk submit behavior at the end of the batch can be removed, and `collectedCounts` state can be removed.

2. **Pin the Numpad & Fix the Layout (Remove Scrolling)**
   - In `packages/mobile/src/app/count.tsx`, remove the `<ScrollView>` wrapping the top section and numpad.
   - Ensure the outer wrapper is `<SafeAreaView style={styles.container}>`.
   - Update `styles.topSection` to have `flex: 1` so it takes the remaining space.
   - Update `styles.counterZone` to have `justifyContent: 'flex-end'` and not `flex: 1`.

3. **Redesign the Barcode Status Pill**
   - In `packages/mobile/src/app/count.tsx`, reposition the barcode indicator to the top-right corner using `position: 'absolute', top: 10, right: 10`.
   - Change the text to ONLY say "Barcode".
   - Use `backgroundColor: 'green'` for success and `backgroundColor: 'gray'` for neutral, and adjust styles appropriately.
   - Make it a small compact pill.

4. **Map the Human-Friendly `display_name`**
   - In `packages/api/routes/cycleCountRoutes.js`, the query at `GET /api/inventory/cycle-count/my-tasks` currently fetches `display_name` by joining `parts_view`. (I checked `head -n 35` and it's already there: `COALESCE(pv.display_name, p.internal_sku, p.detail) AS display_name` and `LEFT JOIN parts_view pv ON pv.part_id = p.part_id`).
   - The UI already renders `{currentLine.display_name}`. So no backend changes are strictly needed, but I will double check the UI and make sure it renders `{currentLine.display_name || currentLine.internal_sku}` as fallback just in case.

5. **Complete pre commit steps**
   - Complete pre commit steps to ensure proper testing, verification, review, and reflection are done.

6. **Submit**
   - Submit the changes using the provided tools.
