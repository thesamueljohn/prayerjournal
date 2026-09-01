function toast(message) {
  const node = document.createElement('div');
  node.textContent = message;
  node.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#102a28;color:#fff;padding:10px 16px;border-radius:8px;z-index:10;font:14px system-ui';
  document.body.append(node);
  setTimeout(() => node.remove(), 2200);
}
const absoluteUrl = (value) => new URL(value, window.location.origin).href;
document.addEventListener('click', async (event) => {
  const share = event.target.closest('.share');
  const copy = event.target.closest('.copy-link');
  if (share) {
    const data = { title: share.dataset.shareTitle, text: share.dataset.shareText, url: absoluteUrl(share.dataset.shareUrl) };
    if (navigator.share) await navigator.share(data).catch(() => {});
    else { await navigator.clipboard.writeText(data.url); toast('Link copied.'); }
  }
  if (copy) { await navigator.clipboard.writeText(absoluteUrl(copy.dataset.copyUrl)); toast('Link copied.'); }
});
