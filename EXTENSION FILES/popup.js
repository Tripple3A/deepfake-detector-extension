// DeepFake Detector Popup Script

document.addEventListener('DOMContentLoaded', function() {
    // For Tab navigation
    setupTabs();
    
    // For URL analysis
    setupUrlAnalysis();
    
    // For loading History content on the tab
    loadHistory();
    
    // Clearing user history of analyzed videos
    document.getElementById('clear-history-btn').addEventListener('click', clearHistory);
    
    // Checking the  current tab for videos
    checkCurrentTabForVideos();
  });
  
  // Setting up tab navigation
  function setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        // Remove active class from all buttons and contents
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        
        // Add active class to clicked button and corresponding content
        button.classList.add('active');
        const tabId = button.getAttribute('data-tab');
        document.getElementById(`${tabId}-tab`).classList.add('active');
      });
    });
  }
  
  // Checking if the current tab has videos
  function checkCurrentTabForVideos() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs.length === 0) return;
      
      const currentTab = tabs[0];
      
      // Checking if this is a known video platform
      const platform = detectPlatform(currentTab.url);
      
     
      const quickAnalyzeSection = document.querySelector('.quick-analyze');
      const platformMessage = document.createElement('div');
      platformMessage.className = 'platform-detected';
      
      // Generating message based on platform
      const platformText = platform !== 'generic' ? 
        `This appears to be a ${capitalizeFirstLetter(platform)} page.` : 
        'You can analyze videos on this page.';
        
      platformMessage.innerHTML = `
        <p>${platformText}</p>
        <button id="analyze-current-btn" class="primary-button">Analyze Current Video</button>
      `;
      

      const orDivider = quickAnalyzeSection.querySelector('.or-divider');
      if (orDivider) {
        quickAnalyzeSection.insertBefore(platformMessage, orDivider);
      } else {
        quickAnalyzeSection.appendChild(platformMessage);
      }
      
      // Adding click handler
      document.getElementById('analyze-current-btn').addEventListener('click', () => {
        // Showing analyzing message (notification)
        platformMessage.innerHTML = '<p>Analyzing current video... Check the page for results.</p>';
        
        // Sending message to analyze the current tab's video
        chrome.tabs.sendMessage(currentTab.id, {
          action: "analyzeCurrentVideo"
        }).catch(error => {
          // If content script isn't ready, sending the message to background script directly
          chrome.runtime.sendMessage({
            action: "analyzeCurrentVideo",
            tabId: currentTab.id
          });
        });
        
        // Closing the popup after a delay
        setTimeout(() => {
          window.close();
        }, 2000);
      });
    });
  }
  
  // Setting up URL analysis functionality
  function setupUrlAnalysis() {
    const urlInput = document.getElementById('video-url');
    const analyzeBtn = document.getElementById('analyze-url-btn');
    const resultContainer = document.getElementById('url-analysis-result');
    
    analyzeBtn.addEventListener('click', () => {
      const url = urlInput.value.trim();
      
      if (!url) {
        showUrlAnalysisResult('error', 'Please enter a video URL');
        return;
      }
      
      // Checking if URL is valid
      if (!isValidUrl(url)) {
        showUrlAnalysisResult('error', 'Please enter a valid URL');
        return;
      }
      
      // Loading the disable button
      analyzeBtn.disabled = true;
      showUrlAnalysisResult('pending', 'Analyzing video...');
      
      // Getting current tab ID
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const tabId = tabs[0].id;
        
        // Sending analysis request to background script
        chrome.runtime.sendMessage({
          action: "analyzeUrl",
          videoUrl: url,
          tabId: tabId
        }, function(response) {
          if (chrome.runtime.lastError) {
            showUrlAnalysisResult('error', 'Error: ' + chrome.runtime.lastError.message);
            analyzeBtn.disabled = false;
            return;
          }
          
          if (response.success) {
            showUrlAnalysisResult('pending', 'Analysis started! Check the page for results.');
            
       
            setTimeout(() => {
              analyzeBtn.disabled = false;
              urlInput.value = "";
            }, 3000);
          } else {
            showUrlAnalysisResult('error', 'Error: ' + (response.error || 'Unknown error'));
            analyzeBtn.disabled = false;
          }
        });
      });
    });
    
    // Adding enter key support for analysis
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !analyzeBtn.disabled) {
        analyzeBtn.click();
      }
    });
  }
  
  // Showing URL analysis result
  function showUrlAnalysisResult(type, message) {
    const resultContainer = document.getElementById('url-analysis-result');
    
    let html = '';
    if (type === 'error') {
      html = `
        <div class="analysis-result error">
          <div class="result-header">
            <div class="result-icon">⚠️</div>
            <div class="result-title">Error</div>
          </div>
          <div>${message}</div>
        </div>
      `;
    } else if (type === 'pending') {
      html = `
        <div class="analysis-result pending">
          <div class="result-header">
            <div class="result-icon">⏳</div>
            <div class="result-title">Processing</div>
          </div>
          <div>${message}</div>
        </div>
      `;
    }
    
    resultContainer.innerHTML = html;
  }
  
  // Loading analysis history
  function loadHistory() {
    const historyList = document.getElementById('history-list');
    
    chrome.runtime.sendMessage({action: "getHistory"}, function(response) {
      if (chrome.runtime.lastError) {
        historyList.innerHTML = `
          <div class="empty-history">
            Error loading history: ${chrome.runtime.lastError.message}
          </div>
        `;
        return;
      }
      
      const history = response.history || [];
      
      if (history.length === 0) {
        historyList.innerHTML = `
          <div class="empty-history">
            No analysis history yet. Analyze some videos to see your history here.
          </div>
        `;
        return;
      }
      
      // Generating history items
      let html = '';
      
      history.forEach(item => {
        const date = new Date(item.date);
        const formattedDate = formatDate(date);
        const isDeepfake = item.result && item.result.deepfake;
        const confidence = item.result ? (item.result.confidence * 100).toFixed(1) : "N/A";
        
        html += `
          <div class="history-item">
            <div class="history-header">
              <div class="history-platform">
                <div class="history-platform-icon ${item.platform || 'generic'}"></div>
                <div class="history-platform-name">${capitalizeFirstLetter(item.platform || 'generic')}</div>
              </div>
              <div class="history-date">${formattedDate}</div>
            </div>
            <div class="history-result ${isDeepfake ? 'deepfake' : 'authentic'}">
              ${isDeepfake ? '⚠️ Deepfake Detected' : '✓ Authentic Video'}
            </div>
            <div class="history-confidence">Confidence: ${confidence}%</div>
            <div class="history-url" title="${item.url}" data-url="${item.url}">${truncateUrl(item.url)}</div>
          </div>
        `;
      });
      
      historyList.innerHTML = html;
      
      // Adding click handlers for URLs
      const urlElements = historyList.querySelectorAll('.history-url');
      urlElements.forEach(el => {
        el.addEventListener('click', () => {
          const url = el.getAttribute('data-url');
          chrome.tabs.create({url: url});
        });
      });
    });
  }
  
  // Clearing analysis history
  function clearHistory() {
    if (confirm('Are you sure you want to clear all analysis history?')) {
      chrome.runtime.sendMessage({action: "clearHistory"}, function(response) {
        if (response && response.success) {
          loadHistory(); // Reloading the history tab (contains previously analyzed videos)
        }
      });
    }
  }
  

  
  // Checking if URL is valid
  function isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }
  
  // Detecting platform from URL
  function detectPlatform(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      
      if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
        return 'youtube';
      } else if (hostname.includes('facebook.com') || hostname.includes('fb.com')) {
        return 'facebook';
      } else if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
        return 'twitter';
      } else if (hostname.includes('instagram.com')) {
        return 'instagram';
      } else if (hostname.includes('tiktok.com')) {
        return 'tiktok';
      } else {
        return 'generic';
      }
    } catch (_) {
      return 'generic';
    }
  }
  
  // Formatting date for display
  function formatDate(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMin < 1) {
      return 'Just now';
    } else if (diffMin < 60) {
      return `${diffMin}m ago`;
    } else if (diffHrs < 24) {
      return `${diffHrs}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
    }
  }
  
  // Truncating URL for display
  function truncateUrl(url) {
    try {
      const urlObj = new URL(url);
      let displayUrl = urlObj.hostname + urlObj.pathname;
      
      if (displayUrl.length > 35) {
        displayUrl = displayUrl.substring(0, 32) + '...';
      }
      
      return displayUrl;
    } catch (_) {
      if (!url) return "Unknown URL";
      return url.length > 35 ? url.substring(0, 32) + '...' : url;
    }
  }
  

  function capitalizeFirstLetter(string) {
    if (!string) return "";
    return string.charAt(0).toUpperCase() + string.slice(1);
  }