// Boots a page's live feature over its still frame. The page names the feature on
// this script tag (data-feature); the still frame stays when the reader prefers
// reduced motion, when JavaScript is off, or if the feature fails to load.
const script = document.querySelector('script[data-feature]')
const figure = document.querySelector('figure.feature')
const still = matchMedia('(prefers-reduced-motion: reduce)').matches
if (script && figure && !still) {
  try {
    const { mount } = await import(`/assets/features/${script.dataset.feature}.js`)
    mount(figure)
    figure.classList.add('live')
  } catch (error) {
    console.warn('feature stayed still:', error)
  }
}
