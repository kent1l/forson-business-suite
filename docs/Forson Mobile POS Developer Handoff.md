# **FORSON MOBILE POS: AI AGENT IMPLEMENTATION PROMPT & HANDOFF**

\<System\_Role\>

You are an Expert React Native & Android Developer working on the "Forson Auto Parts Supply ERP" monorepo. Your objective is to implement a hyper-fast, thumb-optimized, offline-capable Mobile Point of Sale (POS) interface.

\</System\_Role\>

\<Implementation\_Philosophy\>

You have the technical freedom to choose the best implementation methods (hooks, state logic, and component structuring). DO NOT blindly generate code. First, analyze the existing monorepo, database models, and backend endpoints to ensure your code conforms cleanly to the current system architecture.

However, the UI Layout, Visual Hierarchy, Gestures, and Dimensional Rules outlined in the \<Strict\_UI\_Constraints\> section are NON-NEGOTIABLE and MUST be followed exactly to protect the UX integrity of the POS screen.

\</Implementation\_Philosophy\>

## **\<Execution\_Plan\>**

Please follow these steps chronologically:

1. **Analyze:** Scan the repository (specifically packages/mobile, packages/api/routes, and any existing Zustand stores). If available, utilize Graphify to understand the codebase context.  
2. **Propose:** Briefly output your intended directory structure and the backend endpoints you plan to interact with for the checkout/settlement phase.  
3. **Implement:** Write the components and state logic adhering strictly to the constraints below.  
   \</Execution\_Plan\>

## **\<Strict\_UI\_Constraints\>**

### **1\. Macro Architecture & Layout (15 / 40 / 45 Split)**

The screen relies on strict dimensional partitioning to ensure the cart and checkout actions are always within reach of the user's thumb.

* **Root Container:** Ensure the root view handles keyboard insets properly so the bottom sheet is never obscured. Prevent OS-level pull-to-refresh (overscroll-behavior-y: none).  
* **Top Area (15% \- Flex: 0.15):** App Bar & Search. Ensure the Z-index is highest to cast shadows over the scrollable results below.  
* **Middle Area (40% \- Flex: 0.40):** Product Search Results.  
  * *Agent Task:* Analyze our current list-rendering approach. We highly recommend evaluating @shopify/flash-list over standard FlatList to prevent RAM spiking with 10,000+ local SQLite rows.  
* **Bottom Area (45% \- Flex: 0.45):** Cart Bottom Sheet & Checkout. Must be anchored to the bottom of the screen.

### **2\. Gestures & Animation Matrix**

Use existing gesture libraries (react-native-gesture-handler and react-native-reanimated).

* **Swipe Left (Cart Row):** Instantly removes the item. Trigger a 3-second native Snackbar: *"Item removed. \[UNDO\]"*.  
* **Swipe Right (Cart Row):** Instantly opens the Price Override Sheet.  
* **Long Press / 500ms (Cart Row):** Opens the Line-Item Inspect Sheet (Vehicle Fitment, Bin Location, Alternatives).  
* **Price Override Sheet (Modal):** Animate on the **Y-Axis** (translateY: 100% \-\> 0%). Dim the background (rgba(0,0,0,0.5)).  
* **Settlement Screen (New Page):** Animate on the **X-Axis** (translateX: 100% \-\> 0%). This visually pulls the user away from the cart and into the final payment funnel.

### **3\. Haptic Engine Integration**

Implement a global haptic utility using the native Android Vibrator API or our preferred haptic library.

* **UI Tap:** \~10ms vibration (stepper \+/- buttons, opening menus).  
* **Action Success:** \~50ms vibration (scanning a barcode, adding an item, applying override).  
* **Error:** Multiple pulses (\[100ms, 50ms, 100ms\]) for "SKU Not Found" or clear cart attempts.  
* **Transaction Complete:** Triple pulse (\[50ms, 50ms, 50ms\]) fired when the backend API returns a successful ledger update.

## **\<Component\_Specifications\>**

### **A. Search & Camera Input (\<SearchBar /\>)**

* **Input Field:** Apply autoCapitalize="characters". Implement a strict **300ms debounce** on text input before querying the local database. Determine the best hook pattern for this in our stack.  
* **Hardware Hook:** Bind the Android physical **Volume Down** button to globally trigger the react-native-vision-camera instance. Analyze the native device event listeners available in our environment.

### **B. Product List Node (\<ProductListItem /\>)**

* **Touch Target:** The entire row must be an interactive touch target (TouchableOpacity or Pressable).  
* **Action:** Tapping the row instantly dispatches "Add to Cart". **Do not** open a product detail modal on tap.  
* **Typography:** SKU must use the Title Large hierarchy (font-mono, bold). Format prices locally to PHP (₱1,250.00).  
* **Out-of-Stock:** Apply an opacity drop (e.g., 0.6), tint the stock string red, but ensure the row remains fully tappable for backorders.

### **C. Cart Item Row (\<CartItem /\>)**

* **Price Affordance:** The unit price text requires a dotted border-bottom (borderStyle: 'dashed') to signal it is editable. Tapping triggers the price override UI.  
* **Quantity Stepper:** Ensure minimum 48x48dp touch targets for \- and \+ buttons.

## **\<Architecture\_&\_State\_Directives\>**

### **1\. State Management (Zustand)**

We need a highly performant, non-mutating state store for the POS cart. Analyze our existing state management within the monorepo to ensure this integrates cleanly without anti-patterns.

* **Data Structure Expectation:** Needs arrays for cart, numeric grandTotal, and booleans for modal overlays (isPriceOverrideOpen, isSettlementOpen).  
* **Business Logic Inject:** Within your addToCart action, inject a smart quantity check: If product.name contains "Spark Plug" (case-insensitive), initialize the added quantity to 4 instead of 1\.

### **2\. Settlement & Checkout Pipeline**

Analyze our existing backend endpoints (e.g., packages/api/routes/...) to construct a JSON payload that accurately passes cart\_items, payment\_method (Cash, Account, Cheque), and tendered\_amount to the server.

* **Cash Mode:** Auto-focus the tendered input amount. Wire a real-time reactive function to calculate tendered \- grandTotal and display the **Change** in Emerald Green.  
* **The "Instant Reset" Loop:** Upon receiving a 200 OK from the server, implement this exact UX sequence:  
  1. Show the full-screen Emerald Success Overlay.  
  2. Wait \~2000ms.  
  3. Clear the cart state completely.  
  4. Close the Settlement screen.  
  5. **Auto-focus** the top search bar (bringing up the keyboard) so the cashier is immediately ready for the next customer.