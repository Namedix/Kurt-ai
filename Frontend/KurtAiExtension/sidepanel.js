function getMeetingId(url) {
    // Match patterns like: https://meet.google.com/abc-defg-hij
    const meetRegex = /meet\.google\.com\/([a-z0-9\-]+)/i;
    const match = url.match(meetRegex);
    return match ? match[1] : null;
}

function updateConnectionStatus(status, isError = false) {
    const statusElement = document.getElementById('connectionStatus');
    const waveContainer = document.querySelector('.wave-container');
    const connectButton = document.getElementById('connectButton');
    
    statusElement.textContent = status;
    statusElement.className = isError ? 'status-error' : 
                            status === 'Connected' ? 'status-connected' : 
                            'status-connecting';

    // Show/hide wave animation and handle connect button based on connection status
    if (status === 'Connected') {
        waveContainer.style.display = 'flex';
        connectButton.style.display = 'none'; // Hide connect button
        // Use a small delay to ensure the display change takes effect before opacity
        setTimeout(() => {
            waveContainer.style.opacity = '1';
        }, 10);
    } else {
        waveContainer.style.opacity = '0';
        connectButton.style.display = 'block'; // Show connect button
        setTimeout(() => {
            if (status !== 'Connected') {
                waveContainer.style.display = 'none';
            }
        }, 300);
    }
}

function addTimelineEvent(event) {
    const timeline = document.getElementById('timelineMode');
    const eventElement = document.createElement('div');
    eventElement.className = 'timeline-event';
    
    // Add error class if it's an error message
    if (typeof event === 'string' && event.toLowerCase().includes('error')) {
        eventElement.classList.add('error');
    } else if (typeof event === 'string' && event.toLowerCase().includes('success')) {
        eventElement.classList.add('success');
    }
    
    const timestamp = document.createElement('div');
    timestamp.className = 'timestamp';
    timestamp.textContent = new Date().toLocaleTimeString();
    
    const content = document.createElement('div');
    content.className = 'content';

    // Handle ticket events
    if (typeof event === 'object' && event.ticket?.success) {
        const issue = event.ticket.issue;
        const ticketMatch = issue.url.match(/\/([A-Z]+-\d+)\//);
        const shortId = ticketMatch ? ticketMatch[1] : 'TICKET';
        
        let actionText = '';
        switch(event.type) {
            case 'ticket_created':
                actionText = 'added';
                eventElement.classList.add('success');
                break;
            case 'ticket_updated':
                actionText = 'updated';
                eventElement.classList.add('success');
                break;
            default:
                actionText = 'modified';
        }
        
        content.innerHTML = `<a href="${issue.url}" target="_blank" class="ticket-link">[${shortId}] ${issue.title}</a> ${actionText}`;
    } else {
        // Handle other events as before
        content.textContent = typeof event === 'string' ? event : JSON.stringify(event);
    }
    
    eventElement.appendChild(timestamp);
    eventElement.appendChild(content);
    timeline.insertBefore(eventElement, timeline.firstChild);
}

let eventSource = null;

function connectToMeet(meetingUrl) {
    updateConnectionStatus('Connecting...');
    addTimelineEvent('Initiating connection to meeting...');
    console.log('Connecting to meeting:', meetingUrl);

    // Close existing EventSource if any
    if (eventSource) {
        console.log('Closing existing EventSource');
        eventSource.close();
        eventSource = null;
    }

    fetch('http://localhost:54321/functions/v1/connect-to-meets', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
            'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
            meeting_url: meetingUrl
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        function processText(text) {
            const lines = text.split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        console.log('Received data:', data);
                        
                        if (data.type === 'connection' && data.status === 'connected') {
                            updateConnectionStatus('Connected');
                            addTimelineEvent('Successfully connected to meeting');
                        } else if (data.type === 'error') {
                            updateConnectionStatus('Error', true);
                            addTimelineEvent(`Error: ${data.details || data.error}`);
                        } else if (data.type === 'ticket_created' || data.type === 'ticket_updated') {
                            // Pass the parsed object directly for both create and update events
                            addTimelineEvent(data);
                        } else {
                            addTimelineEvent(data.message || JSON.stringify(data));
                        }
                    } catch (error) {
                        console.error('Error parsing SSE data:', error);
                        addTimelineEvent('Error parsing update');
                    }
                }
            }
        }

        function pump() {
            return reader.read().then(({value, done}) => {
                if (done) {
                    console.log('Stream complete');
                    updateConnectionStatus('Disconnected');
                    return;
                }
                
                buffer += decoder.decode(value, {stream: true});
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    processText(line);
                }
                
                return pump();
            });
        }

        pump().catch(error => {
            console.error('Stream error:', error);
            updateConnectionStatus('Error', true);
            addTimelineEvent(`Stream error: ${error.message}`);
        });
    })
    .catch(error => {
        console.error('Connection error:', error);
        updateConnectionStatus('Connection failed', true);
        addTimelineEvent(`Error: ${error.message}`);
    });
}

function checkIfGoogleMeet() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        const currentTab = tabs[0];
        const isMeetPage = currentTab.url.startsWith('https://meet.google.com/');
        const meetId = isMeetPage ? getMeetingId(currentTab.url) : null;
        
        document.getElementById('notMeetMessage').style.display = 
            isMeetPage ? 'none' : 'block';
        document.getElementById('meetContent').style.display = 
            isMeetPage ? 'block' : 'none';

        // Store the meeting ID as a data attribute
        if (meetId) {
            document.getElementById('connectButton').setAttribute('data-meet-id', meetId);
            document.getElementById('meetingId').textContent = `Meeting ID: ${meetId}`;
        }
    });
}

// Clean up EventSource when the panel is closed or hidden
document.addEventListener('visibilitychange', () => {
    if (document.hidden && eventSource) {
        eventSource.close();
        eventSource = null;
        updateConnectionStatus('Disconnected', true);
    }
});

// Check when the panel is opened
checkIfGoogleMeet();

// Listen for tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        checkIfGoogleMeet();
    }
});

// Listen for tab activation changes
chrome.tabs.onActivated.addListener(() => {
    checkIfGoogleMeet();
});

// Add click handler for connect button
document.getElementById('connectButton').addEventListener('click', () => {
    const meetId = document.getElementById('connectButton').getAttribute('data-meet-id');
    if (meetId) {
        const meetingUrl = `https://meet.google.com/${meetId}`;
        connectToMeet(meetingUrl);
    }
}); 