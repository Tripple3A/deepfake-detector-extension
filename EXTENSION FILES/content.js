// DeepFake Detector Content Script
const API_URL = 'https://deepfake-detector-106176227689.us-central1.run.app';
// Track active notifications
let activeNotification = null;
let resultOverlay = null;

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Content script received message:", request);
  
  if (request.action === "showNotification") {
    showNotification(request.type, request.message);
    sendResponse({success: true});
    return true;
  }
  else if (request.action === "showResult") {
    showResultOverlay(request.result);
    sendResponse({success: true});
    return true;
  }
  else if (request.action === "analyzeCurrentVideo") {
    // Forward the request to the background script with current URL
    chrome.runtime.sendMessage({
      action: "analyzeCurrentVideo",
      url: window.location.href
    });
    sendResponse({success: true});
    return true;
  }
});

function showNotification(type, message) {
  console.log(`Showing notification: ${type} - ${message}`);
  
  // Remove existing notification if any
  if (activeNotification) {
    activeNotification.remove();
    activeNotification = null;
  }
  
  // Create notification element
  const notification = document.createElement('div');
  notification.className = 'deepfake-detector-notification';
  
  // Add appropriate class based on type
  if (type === "error") {
    notification.classList.add('error');
  } else if (type === "progress") {
    notification.classList.add('progress');
  } else if (type === "start") {
    notification.classList.add('start');
  } else if (type === "info") {
    notification.classList.add('info');
  }
  
  // Create content
  const icon = document.createElement('div');
  icon.className = 'notification-icon';
  
  // Set icon based on type
  if (type === "error") {
    icon.innerHTML = '⚠️';
  } else if (type === "progress") {
    icon.innerHTML = '⏳';
  } else if (type === "start") {
    icon.innerHTML = '🔍';
  } else if (type === "info") {
    icon.innerHTML = 'ℹ️';
  }
  
  const content = document.createElement('div');
  content.className = 'notification-content';
  content.textContent = message;
  
  // Add close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'notification-close';
  closeBtn.innerHTML = '×';
  closeBtn.addEventListener('click', () => {
    notification.remove();
    activeNotification = null;
  });
  
  // Assemble notification
  notification.appendChild(icon);
  notification.appendChild(content);
  notification.appendChild(closeBtn);
  
  // Add to page
  document.body.appendChild(notification);
  activeNotification = notification;
  
  // Auto-hide after delay (except for errors)
  if (type !== "error") {
    setTimeout(() => {
      if (notification && notification.parentNode) {
        notification.classList.add('hiding');
        setTimeout(() => {
          if (notification && notification.parentNode) {
            notification.remove();
            if (activeNotification === notification) {
              activeNotification = null;
            }
          }
        }, 500);
      }
    }, 5000);
  }
}

// Show detailed result overlay
// Show detailed result overlay
// Show detailed result overlay
function showResultOverlay(result) {
  console.log("Showing result overlay:", result);
  
  // Remove existing overlay if any
  if (resultOverlay) {
    resultOverlay.remove();
    resultOverlay = null;
  }
  
  // Handle API error responses
  if (result.error) {
    showNotification("error", `Analysis failed: ${result.error}`);
    return;
  }
  
  const isDeepfake = result.deepfake;
  
  // Create overlay container
  const overlay = document.createElement('div');
  overlay.className = 'deepfake-detector-result';
  
  if (isDeepfake) {
    overlay.classList.add('deepfake');
  } else {
    overlay.classList.add('authentic');
  }
  
  // Create header
  const header = document.createElement('div');
  header.className = 'result-header';
  
  const title = document.createElement('h2');
  title.textContent = isDeepfake ? 'DEEPFAKE DETECTED' : 'VIDEO APPEARS AUTHENTIC';
  
  const icon = document.createElement('div');
  icon.className = 'result-icon';
  icon.textContent = isDeepfake ? '⚠️' : '✓';
  
  header.appendChild(icon);
  header.appendChild(title);
  
  // Create close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'result-close';
  closeBtn.innerHTML = '×';
  closeBtn.addEventListener('click', () => {
    overlay.remove();
    resultOverlay = null;
  });
  
  header.appendChild(closeBtn);
  
  // Create content
  const content = document.createElement('div');
  content.className = 'result-content';
  
  // Analysis details
  const detailsSection = document.createElement('div');
  detailsSection.className = 'details-section';
  
  // Frames analyzed
  const framesRow = document.createElement('div');
  framesRow.className = 'detail-row';
  
  const framesLabel = document.createElement('div');
  framesLabel.className = 'detail-label';
  framesLabel.textContent = 'Frames Analyzed:';
  
  const framesValue = document.createElement('div');
  framesValue.className = 'detail-value';
  framesValue.textContent = result.frames_analyzed || 0;
  
  framesRow.appendChild(framesLabel);
  framesRow.appendChild(framesValue);
  
  // Add frames analyzed to details section
  detailsSection.appendChild(framesRow);
  
  // Add processing time to details section (FIXED)
  if (result.processingTime) {
    const timeRow = document.createElement('div');
    timeRow.className = 'detail-row';
    
    const timeLabel = document.createElement('div');
    timeLabel.className = 'detail-label';
    timeLabel.textContent = 'Total Processing Time:';
    
    const timeValue = document.createElement('div');
    timeValue.className = 'detail-value';
    timeValue.textContent = result.processingTime > 1000 ? 
      (result.processingTime / 1000).toFixed(1) + 's' : 
      result.processingTime + 'ms';
    
    timeRow.appendChild(timeLabel);
    timeRow.appendChild(timeValue);
    detailsSection.appendChild(timeRow);
  }
  
  // Add API processing time if available (FIXED)
  if (result.apiResponseTime) {
    const apiTimeRow = document.createElement('div');
    apiTimeRow.className = 'detail-row';
    
    const apiTimeLabel = document.createElement('div');
    apiTimeLabel.className = 'detail-label';
    apiTimeLabel.textContent = 'AI Processing Time:';
    
    const apiTimeValue = document.createElement('div');
    apiTimeValue.className = 'detail-value';
    apiTimeValue.textContent = result.apiResponseTime > 1000 ? 
      (result.apiResponseTime / 1000).toFixed(1) + 's' : 
      result.apiResponseTime + 'ms';
    
    apiTimeRow.appendChild(apiTimeLabel);
    apiTimeRow.appendChild(apiTimeValue);
    detailsSection.appendChild(apiTimeRow);
  }
  
  // Add summary/explanation
  const summary = document.createElement('div');
  summary.className = 'result-summary';
  
  if (isDeepfake) {
    summary.innerHTML = `
      <p>Our AI model detected manipulated content in this video.</p>
      <p>Be cautious about sharing or trusting this content.</p>
    `;
  } else {
    summary.innerHTML = `
      <p>No significant signs of manipulation were detected in this video.</p>
      <p>The content appears to be authentic based on our analysis.</p>
    `;
  }
  
  // Assemble content
  content.appendChild(detailsSection);
  content.appendChild(summary);
  
  // ========== ADD FEEDBACK SECTION HERE ==========
  // Add feedback buttons
  const feedbackSection = document.createElement('div');
  feedbackSection.className = 'feedback-section';
  
  const feedbackLabel = document.createElement('div');
  feedbackLabel.textContent = 'Was this analysis correct?';
  feedbackLabel.className = 'feedback-label';
  
  const correctBtn = document.createElement('button');
  correctBtn.textContent = '✓ Yes';
  correctBtn.className = 'feedback-btn correct-btn';
  correctBtn.addEventListener('click', () => provideFeedback(result, true));
  
  const incorrectBtn = document.createElement('button');
  incorrectBtn.textContent = '✗ No';
  incorrectBtn.className = 'feedback-btn incorrect-btn';
  incorrectBtn.addEventListener('click', () => provideFeedback(result, false));

  const notSureBtn = document.createElement('button');
  notSureBtn.textContent = '? Not Sure';
  notSureBtn.className = 'feedback-btn not-sure-btn';
  notSureBtn.addEventListener('click', () => provideFeedback(result, false, null));
  
  feedbackSection.appendChild(feedbackLabel);
  feedbackSection.appendChild(correctBtn);
  feedbackSection.appendChild(incorrectBtn);
  feedbackSection.appendChild(notSureBtn);
  
  content.appendChild(feedbackSection);
  // ========== END FEEDBACK SECTION ==========
  
  // Add help text
  const helpText = document.createElement('div');
  helpText.className = 'help-text';
  helpText.textContent = 'Analysis powered by DeepFake Detector';
  
  // Add CSS styles for timing section and feedback
  const style = document.createElement('style');
  style.textContent = `
    .detail-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .detail-label {
      color: #666;
      font-size: 13px;
    }
    .detail-value {
      font-weight: 500;
      font-size: 13px;
    }
    .timing-section {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #eee;
    }
    .feedback-section {
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid #eee;
      text-align: center;
    }
    .feedback-label {
      margin-bottom: 10px;
      font-size: 14px;
      color: #444;
    }
    .feedback-btn {
      padding: 6px 12px;
      margin: 0 5px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      transition: background-color 0.2s;
    }
    .correct-btn {
      background-color: #4CAF50;
      color: white;
    }
    .incorrect-btn {
      background-color: #f44336;
      color: white;
    }
    .correct-btn:hover {
      background-color: #45a049;
    }
    .incorrect-btn:hover {
      background-color: #d32f2f;
    }
    .not-sure-btn {
    background-color: #757575;
    color: white;
  }
    .not-sure-btn:hover {
    background-color: #616161;
  }
  `;
  document.head.appendChild(style);
  
  // Assemble overlay
  overlay.appendChild(header);
  overlay.appendChild(content);
  overlay.appendChild(helpText);
  
  // Add to page
  document.body.appendChild(overlay);
  resultOverlay = overlay;
  
  // Make overlay draggable
  makeDraggable(overlay, header);
  
  // Add keyboard shortcut to close (Escape key)
  const handleEscKey = (e) => {
    if (e.key === 'Escape' && resultOverlay) {
      resultOverlay.remove();
      resultOverlay = null;
      document.removeEventListener('keydown', handleEscKey);
    }
  };
  
  document.addEventListener('keydown', handleEscKey);
  
  // Log the timing info to console for debugging
  console.log("Result timing info:", {
    processingTime: result.processingTime,
    apiResponseTime: result.apiResponseTime
  });
}

// Replace the provideFeedback function with this updated version
function provideFeedback(result, wasCorrect, userCorrection) {
  console.log("Providing feedback:", { wasCorrect, userCorrection });
  
  // Create frameIds array from any available sources
  let frameIds = [];
  
  // Try to get frameIds from result if they exist
  if (result.frameIds) {
    frameIds = result.frameIds;
  } 
  // Or try to extract them from frames_data if available
  else if (result.frames_data && Array.isArray(result.frames_data)) {
    // If we have frames_data but no frameIds, we'll need to notify the user
    // that their feedback will be recorded but frames won't be saved for training
    console.log("Warning: No frameIds available for feedback, only feedback will be recorded");
  }
  
  // Prepare the feedback data in a format that matches the backend expectations
  const feedbackData = {
    timestamp: Date.now(),
    // Include both nested result and direct fields for robustness
    result: {
      deepfake: result.deepfake,
      confidence: result.confidence
    },
    // Also include direct fields
    deepfake: result.deepfake,
    confidence: result.confidence,
    wasCorrect: wasCorrect,
    frameIds: frameIds,
    userCorrection: userCorrection, // Can be true, false, or null (for "Not Sure")
    source: window.location.hostname // Add source information
  };
  
  console.log("Sending feedback data:", feedbackData);
  
  // Send to your server for continuous learning
  fetch(API_URL + '/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(feedbackData)
  })
  .then(response => {
    if (!response.ok) {
      throw new Error('Server returned ' + response.status);
    }
    return response.json();
  })
  .then(data => {
    console.log("Feedback response:", data);
    if (data.success) {
      let message = "Thank you for your feedback!";
      if (userCorrection !== null) {
        message += " This helps improve our detection.";
      }
      
      showNotification("info", message);
      
      // If the feedback section is in the current overlay, update it
      if (resultOverlay) {
        const feedbackSection = resultOverlay.querySelector('.feedback-section');
        if (feedbackSection) {
          feedbackSection.innerHTML = `<p style="color: #4CAF50; font-weight: 500;">${message}</p>`;
        }
      }
    } else {
      throw new Error(data.error || "Unknown error");
    }
  })
  .catch(error => {
    console.error("Error sending feedback:", error);
    showNotification("error", "Couldn't send feedback. Please try again later.");
  });
}



// Make element draggable
function makeDraggable(element, handle) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  
  if (handle) {
    // If present, the handle is where you move the element from
    handle.style.cursor = 'move';
    handle.onmousedown = dragMouseDown;
  } else {
    // Otherwise, move the element from anywhere inside it
    element.onmousedown = dragMouseDown;
  }

  function dragMouseDown(e) {
    e = e || window.event;
    e.preventDefault();
    // Get the mouse cursor position at startup
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    // Call a function whenever the cursor moves
    document.onmousemove = elementDrag;
  }

  function elementDrag(e) {
    e = e || window.event;
    e.preventDefault();
    // Calculate the new cursor position
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    // Set the element's new position
    element.style.top = (element.offsetTop - pos2) + "px";
    element.style.left = (element.offsetLeft - pos1) + "px";
    element.style.transform = 'none'; // Clear transform to allow manual positioning
  }

  function closeDragElement() {
    // Stop moving when mouse button is released
    document.onmouseup = null;
    document.onmousemove = null;
  }
}

console.log("DeepFake Detector content script loaded");