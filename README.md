# deepfake-detector-extension


🎯 Overview
Deepfake Detector is a Chrome browser extension designed to analyze video content in real-time and detect potential deepfake manipulation. The extension extracts frames from videos, processes them through the AI detection API, and provides users with clear, actionable results about video authenticity.


✨ Features

Real-time Detection: Analyze videos as you browse social media platforms
Multi-platform Support: Works on YouTube, TikTok, Facebook, Instagram, and other video platforms
Multiple Activation Methods:

Browser toolbar button (Analyze Current Video)
Right-click context menu
Keyboard Shortcut (Alt+Shift+F for Windows, Option+Shift+F for Mac)


User-friendly Results: Clear visual indicators with simple explanations
Fast Processing: Results typically delivered within 5-10 seconds

🚀 Installation
From Chrome Web Store 

Visit the Chrome Web Store
Search for "Deepfake Detector" , click on the following icon
<img width="1097" alt="image" src="https://github.com/user-attachments/assets/17e0b202-1aea-4d0a-aa48-5649b698e0d4" />

Click "Add to Chrome"
Confirm the installation by clicking "Add extension"
The Deepfake Detector icon will appear in your browser toolbar

Manual Installation (For Developers)

Download the extension files from the releases section
Open Chrome and navigate to chrome://extensions/
Enable "Developer mode" in the top right corner
Click "Load unpacked" and select the extension folder
The extension will be loaded and ready to use

🔧 How to Use
Quick Start

Navigate to any video content on supported platforms
Activate the detector using one of these methods:

Click the Deepfake Detector icon in your browser toolbar
Click on the button on the extension to trigger the analysis, or use the keyboard shortcut to analyse a video


View results that appear as:

Visual overlay on the video
Pop-up notification
Simple red/green indicator icon



Understanding Results

Green Indicator: Video appears authentic
Red Indicator: Potential deepfake detected





🔍 Supported Platforms

YouTube
TikTok
Facebook
Instagram
Twitter/X
LinkedIn
Most HTML5 video players

⚙️ Technical Requirements

Browser: Chrome 88+ or Chromium-based browsers
Internet Connection: Required for API processing


Permissions:

Access to video content on websites
Network access for API communication



🛠️ How It Works

Frame Extraction: The extension captures key frames from videos
API Processing: Frames are sent to our secure detection API
AI Analysis: Advanced machine learning models analyze visual and audio patterns
Result Delivery: Detection results are returned and displayed to the user

🔒 Privacy & Security

No Video Storage: Videos are not stored on our servers
Frame Processing Only: Only selected frames are analyzed
Encrypted Communication: All API communications use HTTPS
No Personal Data: No personal information is collected or stored

🐛 Troubleshooting
Common Issues
Extension not working on a video:

Ensure the video is fully loaded
Try refreshing the page
Check if the platform is supported

Slow detection results:

Check your internet connection
High traffic may cause temporary delays
Try again after a few moments

Extension icon not visible:

Check if the extension is enabled in chrome://extensions/
Pin the extension to your toolbar for easy access



📊 Performance

Detection Accuracy: 95%+ on tested deepfake samples
Processing Speed: 5-10 seconds average
Platform Coverage: 6+ major social media platforms


🤝 Contributing
We welcome contributions! Please see our Contributing Guidelines for details on:

Reporting bugs
Suggesting features
Code contributions
Documentation improvements





⚠️ Disclaimer
Deepfake Detector is a detection tool that provides assessments based on current AI technology. While highly accurate, no detection system is 100% perfect. Users should use this tool as one factor in evaluating content authenticity and apply critical thinking when consuming online media.

Made with ❤️ for a safer internet
