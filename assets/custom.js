(function () {
  function updatePromosForSubmenu(submenuInner) {
    if (!submenuInner) return;
    var menuHandle = (submenuInner.dataset.menuHandle || '').toLowerCase();
    if (!menuHandle) return;

    var promoBlocks = submenuInner.querySelectorAll('.mega-menu-promo-block');
    promoBlocks.forEach(function (block) {
      var promoHandle = (block.dataset.promoHandle || block.dataset.handle || '').toLowerCase();
      if (promoHandle && promoHandle === menuHandle) {
        block.classList.add('is-active');
      } else {
        block.classList.remove('is-active');
      }
    });
  }

  function handleMenuActivate(event) {
    var link = event.target.closest('.menu-list__link[aria-controls]');
    if (!link) return;

    var submenuId = link.getAttribute('aria-controls');
    if (!submenuId) return;

    var submenuInner = document.getElementById(submenuId);
    if (!submenuInner) return;

    updatePromosForSubmenu(submenuInner);
  }

  document.addEventListener('pointerenter', handleMenuActivate, true);
  document.addEventListener('focusin', handleMenuActivate, true);
})();

document.addEventListener("DOMContentLoaded", function () {
  const bundles = document.querySelectorAll(".bundle-selector__options");

  bundles.forEach(bundle => {
    const parent = bundle.closest('[class*="color-scheme-"]');

    if (parent) {
      const styles = getComputedStyle(parent);
      const bgColor = styles.getPropertyValue("--color-background").trim();

      // ✅ Add inline CSS variable
      bundle.style.setProperty("--color-background", bgColor);
    }
  });
});