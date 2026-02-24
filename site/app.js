const owner = document.body.dataset.owner ?? "anaregdesign";
const repo = document.body.dataset.repo ?? "local-playground";
const repositoryUrl = `https://github.com/${owner}/${repo}`;
const releasesUrl = `https://github.com/${owner}/${repo}/releases`;
const latestReleaseUrl = `${releasesUrl}/latest`;
const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

const macDmgLink = document.querySelector("#download-mac-dmg");
const macZipLink = document.querySelector("#download-mac-zip");
const winX64Link = document.querySelector("#download-win-x64");
const winArm64Link = document.querySelector("#download-win-arm64");
const releaseMetaElement = document.querySelector("#release-meta");
const allReleasesLink = document.querySelector("#all-releases-link");
const repositoryLink = document.querySelector("#repository-link");

if (allReleasesLink) {
  allReleasesLink.href = releasesUrl;
}

if (repositoryLink) {
  repositoryLink.href = repositoryUrl;
}

const anchorDefaults = [
  { element: macDmgLink, label: "DMG" },
  { element: macZipLink, label: "ZIP" },
  { element: winX64Link, label: "x64" },
  { element: winArm64Link, label: "ARM64" },
];

for (const item of anchorDefaults) {
  if (!item.element) {
    continue;
  }

  item.element.textContent = item.label;
  item.element.href = latestReleaseUrl;
  item.element.classList.add("is-disabled");
}

const sortByAssetUpdate = (assets) =>
  [...assets].sort((left, right) => {
    const leftValue = new Date(left.updated_at ?? 0).getTime();
    const rightValue = new Date(right.updated_at ?? 0).getTime();
    return rightValue - leftValue;
  });

const findAsset = (assets, predicate) => sortByAssetUpdate(assets).find(predicate) ?? null;

const applyAsset = (element, asset, readyLabel, missingLabel) => {
  if (!element) {
    return;
  }

  if (asset) {
    element.href = asset.browser_download_url;
    element.textContent = readyLabel;
    element.classList.remove("is-disabled");
    return;
  }

  element.href = latestReleaseUrl;
  element.textContent = missingLabel;
  element.classList.add("is-disabled");
};

const renderUnavailable = () => {
  if (releaseMetaElement) {
    releaseMetaElement.textContent = "Latest release unavailable";
  }
};

const renderRelease = (release) => {
  const assets = Array.isArray(release.assets) ? release.assets : [];

  const macDmg = findAsset(assets, (asset) => /\.dmg$/i.test(asset.name));
  const macZip = findAsset(assets, (asset) => /\.zip$/i.test(asset.name) && /mac/i.test(asset.name));

  const winX64 = findAsset(
    assets,
    (asset) => /\.exe$/i.test(asset.name) && /(win|windows).*(x64|amd64)/i.test(asset.name),
  );
  const winArm64 = findAsset(
    assets,
    (asset) => /\.exe$/i.test(asset.name) && /(win|windows).*arm64/i.test(asset.name),
  );

  applyAsset(macDmgLink, macDmg, "DMG", "DMG");
  applyAsset(macZipLink, macZip, "ZIP", "ZIP");
  applyAsset(winX64Link, winX64, "x64", "x64");
  applyAsset(winArm64Link, winArm64, "ARM64", "ARM64");

  if (releaseMetaElement) {
    const tagName = release.tag_name ?? "latest";
    const linkUrl = release.html_url ?? latestReleaseUrl;
    releaseMetaElement.innerHTML = `Latest: <a href="${linkUrl}">${tagName}</a>`;
  }
};

const loadLatestRelease = async () => {
  try {
    const response = await fetch(apiUrl, {
      headers: {
        Accept: "application/vnd.github+json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      renderUnavailable();
      return;
    }

    const release = await response.json();
    renderRelease(release);
  } catch {
    renderUnavailable();
  }
};

void loadLatestRelease();
