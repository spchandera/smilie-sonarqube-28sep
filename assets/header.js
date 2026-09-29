import { onDocumentLoaded } from '@theme/utilities';

// The <header-menu> element is defined in header-menu.js, which each menu block loads itself.

onDocumentLoaded(() => {
  const header = document.querySelector('#header-component');
  if (!(header instanceof HTMLElement)) return;

  const updateHeaderScrolledState = () => {
    header.classList.toggle('is-scrolled', window.scrollY > 0);
  };

  updateHeaderScrolledState();
  window.addEventListener('scroll', updateHeaderScrolledState, { passive: true });
});
