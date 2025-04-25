// DeepFake Detector Background Script

// API endpoint
const API_URL = 'https://deepfake-detector-106176227689.us-central1.run.app';

// Keep track of analysis history
let analysisHistory = [];

// Separate function to register context menus
function registerContextMenus() {
  // First remove any existing menus to prevent duplicates
  chrome.contextMenus.removeAll(() => {
    console.log("Cleared existing context menus");
    
    // Create a single context menu item that appears for videos and pages
    chrome.contextMenus.create({
      id: "analyze-media",
      title: "Check for Deepfake",
      contexts: ["video", "page"] // This will show on both videos and pages
    }, function() {
      if (chrome.runtime.lastError) {
        console.error("Error creating menu:", chrome.runtime.lastError.message);
      } else {
        console.log("Deepfake detection menu created successfully");
      }
    });
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    // First validate the tab ID
    if (!tabId) {
      console.warn("Cannot send message - no valid tab ID provided");
      return reject(new Error("No valid tab ID"));
    }
    
    // Check if the tab exists first
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        console.warn(`Tab ${tabId} doesn't exist:`, chrome.runtime.lastError.message);
        return reject(new Error(`Tab ${tabId} doesn't exist`));
      }
      
      // Now try to send the message
      chrome.tabs.sendMessage(tabId, message, response => {
        if (chrome.runtime.lastError) {
          // This could be because content script isn't loaded yet
          console.log(`Message failed, will try injecting content script first: ${chrome.runtime.lastError.message}`);
          
          // Try to inject the content script and then retry sending the message
          chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
          }).then(() => {
            // Give the content script a moment to initialize
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId, message, secondResponse => {
                if (chrome.runtime.lastError) {
                  console.error(`Failed even after injecting content script: ${chrome.runtime.lastError.message}`);
                  reject(chrome.runtime.lastError);
                } else {
                  resolve(secondResponse);
                }
              });
            }, 500);
          }).catch(err => {
            console.error("Failed to inject content script:", err);
            reject(err);
          });
        } else {
          // Message sent successfully
          resolve(response);
        }
      });
    });
  });
}

// Register context menus when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  console.log("DeepFake Detector extension installed");
  
  // Register context menus
  registerContextMenus();
  
 
  chrome.storage.local.get(['analysisHistory'], (result) => {
    if (result.analysisHistory) {
      analysisHistory = result.analysisHistory;
    } else {
      chrome.storage.local.set({analysisHistory: []});
    }
  });
});

// Register context menus when browser starts
chrome.runtime.onStartup.addListener(() => {
  console.log("Browser started - reinstalling context menus");
  registerContextMenus();
});

// Add this to handle the keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  console.log("Command received:", command);
  if (command === "analyze-current-video") {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs.length > 0) {
        console.log("Keyboard shortcut: analyzing video in current tab");
        analyzeCurrentVideo(tabs[0].id);
      }
    });
  }
});

// Replace your current notifyUser function with this one
function notifyUser(tabId, type, message) {
  if (!tabId) {
    console.warn("Cannot notify - no valid tab ID");
    return;
  }
  
  sendMessageToTab(tabId, { action: "showNotification", type, message })
    .catch(error => {
      console.warn(`Notification to tab ${tabId} failed: ${error.message}`);
      // We've already tried our best to handle this in sendMessageToTab
    });
}

// Handle context menu clicks - FIXED VERSION
chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log("Menu clicked:", info.menuItemId); // Add logging for debugging
  
  // Make sure tab exists before trying to access tab.id
  if (!tab) {
    console.error("Tab is undefined in onClicked handler");
    return;
  }
  
  // Simplified menu handler - just check for the menu ID we actually use
  if (info.menuItemId === "analyze-media") {
    console.log("Analyzing media in tab:", tab.id);
    analyzeCurrentVideo(tab.id);
  }
});

// Improve background script message handling
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Handle messages for video analysis
  if (msg.action === "analyzeCurrentVideo") {
    // If we have a tabId in the message, use that
    if (msg.tabId) {
      analyzeCurrentVideo(msg.tabId);
      sendResponse({success: true});
    } 
    // If message comes from a tab, use that tab's ID
    else if (sender && sender.tab && sender.tab.id) {
      analyzeCurrentVideo(sender.tab.id);
      sendResponse({success: true});
    } 
    // Otherwise, query for the active tab
    else {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs.length > 0) {
          analyzeCurrentVideo(tabs[0].id);
          sendResponse({success: true});
        } else {
          sendResponse({success: false, error: "No active tab found"});
        }
      });
    }
    return true; // Keep the message channel open for async response
  }
  
  // Handle history related messages
  if (msg.action === "getHistory") {
    sendResponse({history: analysisHistory});
    return true;
  }
  else if (msg.action === "clearHistory") {
    analysisHistory = [];
    chrome.storage.local.set({analysisHistory: []});
    sendResponse({success: true, message: "History cleared"});
    return true;
  }
});

// Analyze current video with simplified approach (no tab capture)
function analyzeCurrentVideo(tabId) {
  console.log(`Analyzing video in tab ${tabId}`);
  
  // Make sure we have a valid tab ID
  if (!tabId) {
    console.error("No valid tab ID for video analysis");
    return;
  }
  
  // Show initial notification with better error handling
  sendMessageToTab(tabId, { 
    action: "showNotification", 
    type: "start", 
    message: "Capturing video frames for analysis..." 
  }).catch(error => {
    console.warn("Could not send initial notification, continuing anyway");
  }).finally(() => {
    // Continue with analysis regardless of notification success
    
    // Inject the capture script with proper error handling
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content-capture.js'],
    })
    .then(() => {
      return chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          // Call the injected function
          return window.captureVideoWithFallbacks?.() || { 
            error: "Capture function not available", 
            frames: [] 
          };
        }
      });
    })
    .then(results => {
      if (!results || !results[0] || !results[0].result) {
        console.error("No capture results received");
        notifyUser(tabId, "error", "Failed to capture video frames");
        return;
      }
      
      const captureData = results[0].result;
      
      if (captureData.error && (!captureData.frames || captureData.frames.length === 0)) {
        console.error("Capture error:", captureData.error);
        notifyUser(tabId, "error", `Failed to capture video: ${captureData.error}`);
        return;
      }
      
      if (!captureData.frames || captureData.frames.length === 0) {
        console.error("No frames captured");
        notifyUser(tabId, "error", "No video frames could be captured for analysis");
        return;
      }
      
      // Process successful capture results
      processVideoFrames(tabId, captureData);
    })
    .catch(error => {
      console.error("Script execution error:", error);
      notifyUser(tabId, "error", `Capture failed: ${error.message || "Unknown error"}`);
    });
  });
}

// Helper function to process video frames after successful capture
function processVideoFrames(tabId, captureData) {
  // Get tab URL for storing in history
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      console.error("Error getting tab info:", chrome.runtime.lastError);
      notifyUser(tabId, "error", "Failed to get video information");
      return;
    }
    
    const videoDetails = {
      width: captureData.width,
      height: captureData.height,
      timestamp: Date.now(),
      randomId: Math.random().toString(36).substring(2, 15),
      url: tab.url,
      platform: detectPlatformFromUrl(tab.url),
      frameRate: captureData.frameRate || 30,
      duration: captureData.duration || 0,
      capturePositions: captureData.capturePositions || [],
      frameCount: captureData.frames.length,
      method: captureData.method || "standard"
    };
    
    // Create appropriate message based on capture method
    let frameCountMessage;
    if (captureData.method === "webrtc") {
      frameCountMessage = `Captured ${captureData.frames.length} frames using screen capture (WebRTC fallback mode)`;
    } else if (captureData.isFallback) {
      frameCountMessage = `Sending ${captureData.frames.length} frames from current position (fallback mode)`;
    } else {
      frameCountMessage = `Sending ${captureData.frames.length} diverse frames from throughout the ${videoDetails.duration.toFixed(1)}s video`;
    }
    
    console.log(frameCountMessage);
    notifyUser(tabId, "progress", frameCountMessage);
    
    // Send frames to API for analysis
    analyzeFrames(tabId, captureData.frames, videoDetails);
  });
}

// Send frames to API for analysis - fixed version
// Optimized hybrid function to send frames with conditional batch processing
function analyzeFrames(tabId, frames, metadata) {
  // Generate request ID
  const requestId = metadata.randomId;
  
  // Start measuring time
  const startTime = performance.now();
  
  // Show a notification about frame count
  notifyUser(tabId, "progress", `Processing ${frames.length} video frames...`);
  
  // Check if we have enough frames for a good analysis
  if (frames.length < 10) {
    console.warn(`Only ${frames.length} frames captured - analysis may be less accurate`);
    notifyUser(tabId, "progress", `Note: Limited frames (${frames.length}) may affect accuracy`);
  } else {
    console.log(`Good frame count: ${frames.length} frames for analysis`);
  }
  
  // ===== HYBRID APPROACH: THRESHOLD-BASED BATCH PROCESSING =====
  // Configure batch processing parameters
  const BATCH_THRESHOLD = 100; // Only use batches for videos with more than this many frames
  const MAX_FRAMES_PER_BATCH = 200; // Maximum frames per batch (increased from original)
  
  // Decide whether to use batch processing based on frame count
  const useBatchProcessing = frames.length > BATCH_THRESHOLD;
  
  console.log(`Using ${useBatchProcessing ? 'batch' : 'single-request'} processing mode for ${frames.length} frames`);
  
  // Prepare base metadata for API
  const baseRequestData = {
    id: requestId,
    timestamp: metadata.timestamp,
    dimensions: `${metadata.width}x${metadata.height}`,
    frameCount: frames.length,
    source: metadata.platform || 'unknown',
    version: '1.2', // Track extension version for API compatibility
    facial_data: metadata.facialFrameCount !== undefined ? metadata.facialFrameCount : 0
  };
  
  // If not using batch processing, send all frames at once (original behavior)
  if (!useBatchProcessing) {
    sendFrameBatch(frames, baseRequestData, tabId, 1, 1);
    return;
  }
  
  // For batch processing mode, determine optimal batch size
  const batchSize = Math.min(MAX_FRAMES_PER_BATCH, Math.ceil(frames.length / 3));
  const numBatches = Math.ceil(frames.length / batchSize);
  
  console.log(`Batch processing: Sending ${frames.length} frames in ${numBatches} batches (batch size: ${batchSize})`);
  
  // Initialize batch tracking
  let currentBatch = 1;
  let processedResults = [];
  
  // Function to send the next batch
  const processNextBatch = () => {
    if (currentBatch > numBatches) {
      // All batches processed, combine results
      combineResults(processedResults, tabId, metadata);
      return;
    }
    
    const start = (currentBatch - 1) * batchSize;
    const end = Math.min(start + batchSize, frames.length);
    const batchFrames = frames.slice(start, end);
    
    notifyUser(tabId, "progress", `Processing batch ${currentBatch}/${numBatches} (${batchFrames.length} frames)...`);
    
    sendFrameBatch(
      batchFrames, 
      {...baseRequestData, batch: currentBatch, totalBatches: numBatches},
      tabId,
      currentBatch,
      numBatches,
      (result) => {
        if (result && !result.error) {
          processedResults.push(result);
        }
        currentBatch++;
        processNextBatch();
      }
    );
  };
  
  // Start processing batches
  processNextBatch();
  
  // Function to send a single batch of frames
  function sendFrameBatch(batchFrames, requestData, tabId, batchNum, totalBatches, callback) {
    // Clone the request data and add the frames
    const fullRequestData = {
      ...requestData,
      frames: batchFrames
    };
    
    console.log(`Sending ${totalBatches > 1 ? `batch ${batchNum}/${totalBatches} with ` : ''}${batchFrames.length} frames to API`);
    
    // Add timeout for the API request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
    
    // Send to API with explicit no-cache headers
    fetch(API_URL + '/frames', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': totalBatches > 1 ? `${requestData.id}-batch-${batchNum}` : requestData.id,
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache'
      },
      body: JSON.stringify(fullRequestData),
      signal: controller.signal
    })
    .then(response => {
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorMsg = `API error: ${response.status}`;
        console.error(errorMsg);
        
        // Check for specific status codes
        if (response.status === 413) {
          throw new Error("Request too large. Try analyzing a shorter video segment.");
        } else if (response.status === 429) {
          throw new Error("Too many requests. Please try again later.");
        } else if (response.status >= 500) {
          throw new Error("Server error. Our detection service is currently experiencing issues.");
        } else {
          throw new Error(errorMsg);
        }
      }
      return response.json();
    })
    .then(result => {
      console.log(`API response ${totalBatches > 1 ? `for batch ${batchNum}/${totalBatches}` : ''}:`, result);
      
      // If this is the only batch or the last one, show the result directly
      if (totalBatches === 1) {
        // Calculate total processing time
        const totalTime = Math.round(performance.now() - startTime);
        
        // Validate and normalize the result
        const validatedResult = {
          deepfake: result.deepfake === true,
          confidence: parseFloat(result.confidence) || 0.5,
          frames_analyzed: parseInt(result.frames_analyzed) || batchFrames.length,
          deepfake_frames: parseInt(result.deepfake_frames) || 0,
          timestamp: requestData.timestamp,
          requestId: requestData.id,
          framesSent: batchFrames.length,
          frameTimes: metadata?.capturePositions || [],
          // Add timing information
          processingTime: totalTime,
          clientProcessingTime: totalTime,
          apiResponseTime: result.processing_time_ms || result.processing_time || 0
        };
        
        // Additional verification to ensure we got a valid result
        if (validatedResult.frames_analyzed === 0) {
          throw new Error("The API didn't analyze any frames. Please try again.");
        }
        
        // Show result
        showAnalysisResult(tabId, validatedResult, metadata);
      } else {
        // For multi-batch processing, call the callback with the result
        if (callback) callback(result);
      }
    })
    .catch(error => {
      clearTimeout(timeoutId);
      console.error(`API request failed ${totalBatches > 1 ? `for batch ${batchNum}/${totalBatches}` : ''}:`, error);
      
      // Create user-friendly error message
      let errorMessage = "Analysis failed";
      
      if (error.name === 'AbortError') {
        errorMessage = "Analysis timed out. The video may be too long or complex.";
      } else if (error.message) {
        errorMessage = `${errorMessage}: ${error.message}`;
      }
      
      // Only show error to user if this is the only batch or if we haven't started processing batches yet
      if (totalBatches === 1 || batchNum === 1) {
        notifyUser(tabId, "error", errorMessage);
      }
      
      // Call callback with error result
      if (callback) callback({ error: errorMessage });
    });
  }
  
  // Function to combine results from multiple batches
  function combineResults(results, tabId, metadata) {
    console.log(`Combining results from ${results.length} batches`);
    
    // Handle case where we have no valid results
    if (results.length === 0) {
      notifyUser(tabId, "error", "Analysis failed: No valid results received from any batch");
      return;
    }
    
    // Calculate combined metrics
    let totalFramesAnalyzed = 0;
    let totalDeepfakeFrames = 0;
    let totalConfidenceSum = 0;
    let hasDeepfake = false;
    
    // Process each batch result
    results.forEach(result => {
      const framesAnalyzed = parseInt(result.frames_analyzed) || 0;
      const deepfakeFrames = parseInt(result.deepfake_frames) || 0;
      const confidence = parseFloat(result.confidence) || 0.5;
      
      totalFramesAnalyzed += framesAnalyzed;
      totalDeepfakeFrames += deepfakeFrames;
      totalConfidenceSum += confidence * framesAnalyzed; // Weight by frames analyzed
      
      // If any batch detected deepfake with high confidence, mark as deepfake
      if (result.deepfake === true && confidence > 0.6) {
        hasDeepfake = true;
      }
    });
    
    // Determine final deepfake status based on proportion and confidence
    const deepfakeRatio = totalFramesAnalyzed > 0 ? totalDeepfakeFrames / totalFramesAnalyzed : 0;
    const averageConfidence = totalFramesAnalyzed > 0 ? totalConfidenceSum / totalFramesAnalyzed : 0.5;
    
    // Final decision logic - tuned to reduce false positives
    let finalDeepfakeStatus;
    if (hasDeepfake) {
      // If any batch had high confidence deepfake, trust that result
      finalDeepfakeStatus = true;
    } else if (deepfakeRatio >= 0.25) {
      // If a significant portion of frames were detected as deepfake
      finalDeepfakeStatus = true;
    } else {
      // Otherwise mark as authentic
      finalDeepfakeStatus = false;
    }
    
    console.log(`Combined analysis: ${deepfakeRatio.toFixed(4)} deepfake ratio (${totalDeepfakeFrames}/${totalFramesAnalyzed}), ${averageConfidence.toFixed(4)} avg confidence`);
    
    // Prepare the combined result
    const combinedResult = {
      deepfake: finalDeepfakeStatus,
      confidence: averageConfidence,
      frames_analyzed: totalFramesAnalyzed,
      deepfake_frames: totalDeepfakeFrames,
      timestamp: metadata.timestamp,
      requestId: metadata.randomId,
      framesSent: metadata.frameCount || frames.length,
      frameTimes: metadata.capturePositions || [],
      batches: results.length
    };
    
    // Show the combined result
    showAnalysisResult(tabId, combinedResult, metadata);
  }
}

// Show analysis result
function showAnalysisResult(tabId, result, metadata) {
    console.log("Showing analysis result:", result);

    chrome.tabs.sendMessage(tabId, {
      action: "showResult",
      result: result
    });
    
    // Save to history
    const historyEntry = {
      id: result.requestId,
      date: new Date().toISOString(),
      url: metadata.url,
      platform: metadata.platform || detectPlatformFromUrl(metadata.url),
      result: result
    };
    
    // Add to history
    analysisHistory.unshift(historyEntry);
    if (analysisHistory.length > 50) {
      analysisHistory = analysisHistory.slice(0, 50);
    }
    
    // Save to storage
    chrome.storage.local.set({analysisHistory: analysisHistory});
}

// Helper function to detect platform from URL
function detectPlatformFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return 'youtube';
    } else if (hostname.includes('facebook.com') || hostname.includes('fb.com')) {
      return 'facebook';
    } else if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
      return 'twitter';
    } else if (hostname.includes('instagram.com') || hostname.includes('ig.com')) {
      return 'instagram';
    } else if (hostname.includes('tiktok.com')) {
      return 'tiktok';
    } else if (hostname.includes('threads.net')) {
      return 'threads';
    } else {
      return 'generic';
    }
  } catch (_) {
    return 'generic';
  }
}

console.log("DeepFake Detector background script loaded");