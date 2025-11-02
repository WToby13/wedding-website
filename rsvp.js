// Toggle button functionality
document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        const group = this.closest('.toggle-group');
        const hiddenInput = this.closest('.form-group').querySelector('input[type="hidden"]');
        
        // Remove active class from all buttons in the group
        group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        
        // Add active class to clicked button
        this.classList.add('active');
        
        // Update hidden input value
        if (hiddenInput) {
            hiddenInput.value = this.getAttribute('data-value');
        }
    });
});

// Form submission
document.getElementById('rsvp-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const formData = {
        guestName: document.getElementById('guest-name').value.trim(),
        joining: document.getElementById('joining').value || '',
        dietary: document.getElementById('dietary').value.trim(),
        tennis: document.getElementById('tennis').value || '',
        sunbeds: document.getElementById('sunbeds').value || '',
        message: document.getElementById('message').value.trim(),
        timestamp: new Date().toISOString()
    };
    
    // Validate required fields
    if (!formData.guestName || !formData.joining || !formData.tennis || !formData.sunbeds) {
        alert('Please fill in all required fields.');
        return;
    }
    
    // Submit to Google Sheets via Apps Script
    const submitBtn = document.querySelector('.rsvp-submit-btn');
    const originalText = submitBtn.textContent;
    
    submitBtn.textContent = 'Submitting...';
    submitBtn.disabled = true;
    
    // Google Apps Script web app URL for form submissions
    const scriptURL = 'https://script.google.com/macros/s/AKfycbw8MwX2eJpP3Q1BewOoPukZMNyEoAVd-CTcn48jRmlUn8rfwCHvBwIWRvuZqebCrHT9Ig/exec';
    
    // If URL not configured, show error
    if (scriptURL === 'YOUR_GOOGLE_APPS_SCRIPT_URL') {
        alert('RSVP form is not yet configured. Please contact the website administrator.');
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
        return;
    }
    
    try {
        // Submit form data
        await fetch(scriptURL, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData)
        });
        
        // Show success message (no-cors means we can't verify, but we assume success)
        document.getElementById('rsvp-form').classList.add('hidden');
        document.getElementById('success-message').classList.remove('hidden');
        
        // Scroll to success message
        document.getElementById('success-message').scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Reset form after showing success
        setTimeout(() => {
            this.reset();
            document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
            document.getElementById('rsvp-form').classList.remove('hidden');
            document.getElementById('success-message').classList.add('hidden');
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }, 5000); // Reset after 5 seconds
        
    } catch (error) {
        console.error('Error:', error);
        alert('There was an error submitting your RSVP. Please try again or contact us directly at olsenandrea96@gmail.com');
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }
});

