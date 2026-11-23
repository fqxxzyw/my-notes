/** Apply short-lived local URLs without changing the Markdown image destination. */
export function applyImageUrls(root: ParentNode, urls: Readonly<Record<string, string>> = {}): void {
  for (const image of root.querySelectorAll<HTMLImageElement>('img')) {
    const source = image.dataset.paperImageSource || image.getAttribute('src') || ''
    if (!source) continue
    const replacement = Object.prototype.hasOwnProperty.call(urls, source) ? urls[source] : undefined
    if (replacement && /^blob:/i.test(replacement)) {
      image.dataset.paperImageSource = source
      image.setAttribute('src', replacement)
    } else if (/^(?:\.\/)?assets\//i.test(source)) {
      // A not-yet-loaded attachment must not accidentally resolve relative to
      // the application page. Retain its original destination for hydration.
      image.dataset.paperImageSource = source
      image.removeAttribute('src')
    }
  }
}

export function originalImageSource(image: HTMLImageElement): string {
  return image.dataset.paperImageSource || image.getAttribute('src') || ''
}
