// Wedding Landing Page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Loading Animation
    const loadingScreen = document.getElementById('loading-screen');
    const mainContent = document.getElementById('main-content');
    
    // Simulate loading time
    setTimeout(() => {
        loadingScreen.classList.add('hidden');
        mainContent.classList.remove('hidden');
        
        // Remove loading screen from DOM after animation
        setTimeout(() => {
            loadingScreen.style.display = 'none';
        }, 800);
    }, 3000); // 3 second loading animation
    
    // Accordion Folder Functionality
    const folders = document.querySelectorAll('.folder');
    
    folders.forEach(folder => {
        const header = folder.querySelector('.folder-header');
        const content = folder.querySelector('.folder-content');
        
        header.addEventListener('click', () => {
            const isActive = folder.classList.contains('active');
            
            // Close all other folders first
            folders.forEach(otherFolder => {
                if (otherFolder !== folder) {
                    otherFolder.classList.remove('active');
                }
            });
            
            // Toggle current folder with delay for smooth accordion effect
            setTimeout(() => {
                if (isActive) {
                    folder.classList.remove('active');
                } else {
                    folder.classList.add('active');
                    
                    // Smooth scroll to expanded folder
                    setTimeout(() => {
                        folder.scrollIntoView({
                            behavior: 'smooth',
                            block: 'center'
                        });
                    }, 300);
                }
            }, 100);
        });
    });
    
    // Smooth scrolling for internal links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
    
    // Add scroll effect to hero section
    window.addEventListener('scroll', () => {
        const hero = document.querySelector('.hero');
        const scrollY = window.scrollY;
        const opacity = Math.max(0, 1 - scrollY / (window.innerHeight * 0.5));
        
        hero.style.opacity = opacity;
    });
    
    // Add fade-in animation for sections when they come into view
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);
    
    // Observe folder elements for fade-in effect
    folders.forEach(folder => {
        folder.style.opacity = '0';
        folder.style.transform = 'translateY(30px)';
        folder.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
        observer.observe(folder);
    });
    
    // Observe RSVP section
    const rsvpSection = document.querySelector('.rsvp-section');
    if (rsvpSection) {
        rsvpSection.style.opacity = '0';
        rsvpSection.style.transform = 'translateY(30px)';
        rsvpSection.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
        observer.observe(rsvpSection);
    }
    
    // Add subtle parallax effect to hero background
    window.addEventListener('scroll', () => {
        const scrolled = window.pageYOffset;
        const hero = document.querySelector('.hero');
        const rate = scrolled * -0.5;
        
        hero.style.transform = `translateY(${rate}px)`;
    });
    
    // Add keyboard navigation for folders
    folders.forEach(folder => {
        const header = folder.querySelector('.folder-header');
        
        header.setAttribute('tabindex', '0');
        header.setAttribute('role', 'button');
        header.setAttribute('aria-expanded', 'false');
        
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                header.click();
            }
        });
        
        // Update aria-expanded when folder state changes
        const observer = new MutationObserver(() => {
            header.setAttribute('aria-expanded', folder.classList.contains('active'));
        });
        
        observer.observe(folder, { attributes: true, attributeFilter: ['class'] });
    });
    
    // Add loading state to RSVP button
    const rsvpButton = document.querySelector('.rsvp-button');
    if (rsvpButton) {
        rsvpButton.addEventListener('click', function(e) {
            // Add a subtle loading state
            const originalText = this.textContent;
            this.textContent = 'Opening email...';
            this.style.opacity = '0.7';
            
            // Reset after a short delay
            setTimeout(() => {
                this.textContent = originalText;
                this.style.opacity = '1';
            }, 1000);
        });
    }
    
    // Add typing animation to hero titles (optional enhancement)
    const heroTitles = document.querySelectorAll('.hero-title');
    heroTitles.forEach((title, index) => {
        const text = title.textContent;
        title.textContent = '';
        
        setTimeout(() => {
            let i = 0;
            const typeWriter = () => {
                if (i < text.length) {
                    title.textContent += text.charAt(i);
                    i++;
                    setTimeout(typeWriter, 100);
                }
            };
            typeWriter();
        }, 500 + (index * 500)); // Stagger the animations
    });
    
    // Add subtle hover effects to folder icons
    const folderIcons = document.querySelectorAll('.folder-icon');
    folderIcons.forEach(icon => {
        const svg = icon.querySelector('svg');
        if (svg) {
            icon.addEventListener('mouseenter', () => {
                icon.style.transform = 'scale(1.1)';
                svg.style.transform = 'rotate(5deg)';
                icon.style.transition = 'transform 0.3s ease';
                svg.style.transition = 'transform 0.3s ease';
            });
            
            icon.addEventListener('mouseleave', () => {
                icon.style.transform = 'scale(1)';
                svg.style.transform = 'rotate(0deg)';
            });
        }
    });
    
    // Performance optimization: Throttle scroll events
    let ticking = false;
    
    function updateScrollEffects() {
        // Hero parallax effect
        const scrolled = window.pageYOffset;
        const hero = document.querySelector('.hero');
        const rate = scrolled * -0.3;
        
        if (hero) {
            hero.style.transform = `translateY(${rate}px)`;
        }
        
        ticking = false;
    }
    
    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(updateScrollEffects);
            ticking = true;
        }
    });
});
