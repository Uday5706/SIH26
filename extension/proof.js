chrome.storage.local.get(['latestRedactedImage'], (res) => {
  if (res.latestRedactedImage) {
    document.getElementById('proofImage').src = res.latestRedactedImage;
  }
});
