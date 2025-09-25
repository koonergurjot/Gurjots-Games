# How to integrate the Audit Pack

1. **Upload** everything in this zip to your repo root (it only adds files).
2. Visit **/health/catalog-verifier.html** to confirm your catalog is valid and assets exist.
3. Visit **/health/runlist.html** to quickly open each game page and sanity check initial load.
4. To enable diagnostics everywhere without touching each game page:
   - Add this line to your game pages (or your router/shell that wraps them):
     ```html
     <script src="../common/diag-autowire.js" data-game="{{slug}}"></script>
     ```
   - This will inject `../common/diag-upgrades.js` automatically if missing.

**Rollback:** Delete the added files if you don’t need them.
