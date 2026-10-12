import { Metadata } from 'next'
import { CodeBlock, Callout, PrevNextNav } from '@/components/docs'

export const metadata: Metadata = {
  title: 'IAP Media Tools',
  description: 'MCP tools for uploading review screenshots and promotional images for in-app purchases and subscriptions.'
}

export default function IAPMediaToolsPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold text-white mb-4">IAP Media Tools</h1>
      <p className="text-xl text-white/60 mb-10 leading-relaxed">
        Upload review screenshots and promotional images for in-app purchases and subscriptions
        using AI assistants like Claude.
      </p>

      <Callout type="info" title="Required for App Store Submission">
        <p>
          Review screenshots are required for App Store submission of in-app purchases and
          subscriptions. Promotional images are optional but recommended for featuring in
          the App Store.
        </p>
      </Callout>

      <h2 id="overview" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-10">
        Overview
      </h2>
      <p className="text-white/70 mt-6 leading-relaxed">
        These tools allow you to manage media assets for your in-app purchases and subscriptions:
      </p>

      <div className="overflow-x-auto rounded-lg border border-white/[0.08] mt-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] bg-white/[0.02]">
              <th className="px-4 py-3 text-left font-medium text-white/60">Tool</th>
              <th className="px-4 py-3 text-left font-medium text-white/60">Description</th>
            </tr>
          </thead>
          <tbody className="text-white/70">
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">get_iap_screenshot</code></td>
              <td className="px-4 py-3">Get the current review screenshot for an IAP</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">upload_iap_screenshot</code></td>
              <td className="px-4 py-3">Upload a review screenshot for an IAP</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">delete_iap_screenshot</code></td>
              <td className="px-4 py-3">Delete the review screenshot for an IAP</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">get_iap_promotional_image</code></td>
              <td className="px-4 py-3">Get the current promotional image for an IAP</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">upload_iap_promotional_image</code></td>
              <td className="px-4 py-3">Upload a promotional image for an IAP</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">delete_iap_promotional_image</code></td>
              <td className="px-4 py-3">Delete the promotional image for an IAP</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-green-400">get_subscription_screenshot</code></td>
              <td className="px-4 py-3">Get the current review screenshot for a subscription</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-green-400">upload_subscription_screenshot</code></td>
              <td className="px-4 py-3">Upload a review screenshot for a subscription</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-green-400">delete_subscription_screenshot</code></td>
              <td className="px-4 py-3">Delete the review screenshot for a subscription</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-green-400">get_subscription_promotional_image</code></td>
              <td className="px-4 py-3">Get the current promotional image for a subscription</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-green-400">upload_subscription_promotional_image</code></td>
              <td className="px-4 py-3">Upload a promotional image for a subscription</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code className="text-green-400">delete_subscription_promotional_image</code></td>
              <td className="px-4 py-3">Delete the promotional image for a subscription</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="upload-screenshot" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        upload_iap_screenshot / upload_subscription_screenshot
      </h2>
      <p className="text-white/70 mt-6 leading-relaxed">
        Upload a review screenshot for an in-app purchase or subscription. The screenshot is
        displayed to App Store reviewers during the review process.
      </p>

      <h3 className="text-lg font-semibold text-white mt-6 mb-3">Parameters</h3>
      <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] bg-white/[0.02]">
              <th className="px-4 py-3 text-left font-medium text-white/60">Parameter</th>
              <th className="px-4 py-3 text-left font-medium text-white/60">Type</th>
              <th className="px-4 py-3 text-left font-medium text-white/60">Required</th>
              <th className="px-4 py-3 text-left font-medium text-white/60">Description</th>
            </tr>
          </thead>
          <tbody className="text-white/70">
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">projectId</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">The project ID</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">iapId / subscriptionId</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">The IAP or subscription ID</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">fileName</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">File name (e.g., &quot;screenshot.png&quot;)</td>
            </tr>
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3"><code className="text-purple-400">imageData</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-red-400">Yes</span></td>
              <td className="px-4 py-3">Base64 encoded image data (without data URL prefix)</td>
            </tr>
            <tr>
              <td className="px-4 py-3"><code className="text-purple-400">mimeType</code></td>
              <td className="px-4 py-3"><code className="text-amber-400">string</code></td>
              <td className="px-4 py-3"><span className="text-white/40">No</span></td>
              <td className="px-4 py-3">Image MIME type (default: image/png)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 className="text-lg font-semibold text-white mt-6 mb-3">Response</h3>
      <CodeBlock
        code={`{
  "success": true,
  "screenshot": {
    "fileName": "screenshot.png",
    "mimeType": "image/png",
    "fileSize": 245678,
    "r2Url": "https://cdn.applistingagent.com/iap-media/..."
  }
}`}
        language="json"
      />

      <h2 id="upload-promo" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        upload_iap_promotional_image / upload_subscription_promotional_image
      </h2>
      <p className="text-white/70 mt-6 leading-relaxed">
        Upload a promotional image for an in-app purchase or subscription. Promotional images
        are used in App Store promotional campaigns and featured placements.
      </p>

      <h3 className="text-lg font-semibold text-white mt-6 mb-3">Parameters</h3>
      <p className="text-white/70">
        Same parameters as screenshot upload tools.
      </p>

      <h3 className="text-lg font-semibold text-white mt-6 mb-3">Response</h3>
      <CodeBlock
        code={`{
  "success": true,
  "image": {
    "fileName": "promo.png",
    "mimeType": "image/png",
    "fileSize": 512000,
    "r2Url": "https://cdn.applistingagent.com/iap-media/..."
  }
}`}
        language="json"
      />

      <h2 id="image-specs" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Image Specifications
      </h2>
      <div className="overflow-x-auto rounded-lg border border-white/[0.08] mt-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] bg-white/[0.02]">
              <th className="px-4 py-3 text-left font-medium text-white/60">Type</th>
              <th className="px-4 py-3 text-left font-medium text-white/60">Size</th>
              <th className="px-4 py-3 text-left font-medium text-white/60">Format</th>
              <th className="px-4 py-3 text-left font-medium text-white/60">Purpose</th>
            </tr>
          </thead>
          <tbody className="text-white/70">
            <tr className="border-b border-white/[0.05]">
              <td className="px-4 py-3">Review Screenshot</td>
              <td className="px-4 py-3">640 x 920 px</td>
              <td className="px-4 py-3">PNG, JPEG</td>
              <td className="px-4 py-3">Shown to App Store reviewers</td>
            </tr>
            <tr>
              <td className="px-4 py-3">Promotional Image</td>
              <td className="px-4 py-3">1024 x 1024 px</td>
              <td className="px-4 py-3">PNG, JPEG</td>
              <td className="px-4 py-3">Featured in App Store promotions</td>
            </tr>
          </tbody>
        </table>
      </div>

      <Callout type="warning" title="File Size Limit">
        <p>
          Maximum file size is 5MB. Images are stored in Cloudflare R2 and served via CDN.
        </p>
      </Callout>

      <h2 id="example" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Example Usage
      </h2>
      <p className="text-white/70 mt-6 leading-relaxed">
        Ask Claude to upload media for your IAP or subscription:
      </p>
      <CodeBlock
        code={`"Upload a review screenshot for my premium subscription"

"Add a promotional image to the 100 coins IAP"

"Get the current screenshot for subscription sub_abc123"

"Delete the promotional image from the pro_monthly subscription"`}
        language="text"
        title="Natural Language Prompts"
      />

      <h2 id="get-delete" className="text-2xl font-bold text-white border-b border-white/[0.08] pb-3 mt-12">
        Get &amp; Delete Tools
      </h2>
      <p className="text-white/70 mt-6 leading-relaxed">
        The get and delete tools take only <code>projectId</code> and <code>iapId</code> or{' '}
        <code>subscriptionId</code> parameters.
      </p>

      <h3 className="text-lg font-semibold text-white mt-6 mb-3">Get Response</h3>
      <CodeBlock
        code={`{
  "success": true,
  "screenshot": {
    "fileName": "screenshot.png",
    "mimeType": "image/png",
    "fileSize": 245678,
    "r2Url": "https://cdn.applistingagent.com/iap-media/...",
    "uploadedAt": "2024-01-15T10:30:00Z"
  }
}

// If no screenshot exists:
{
  "success": true,
  "screenshot": null
}`}
        language="json"
      />

      <h3 className="text-lg font-semibold text-white mt-6 mb-3">Delete Response</h3>
      <CodeBlock
        code={`{
  "success": true
}`}
        language="json"
      />

      <Callout type="tip" title="Pro Tip">
        <p>
          Use the <code>generate_screenshot</code> tool to create marketing screenshots,
          then use these IAP media tools to upload them as review screenshots for your
          in-app purchases and subscriptions.
        </p>
      </Callout>

      <PrevNextNav />
    </article>
  )
}
