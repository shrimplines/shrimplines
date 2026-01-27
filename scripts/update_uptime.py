import re
from datetime import datetime

BORN = datetime(2011, 3, 6, 16, 52)

def get_uptime():
    now = datetime.now()
    diff = now - BORN
    
    # Standard date math for display
    years = diff.days // 365
    days_left = diff.days % 365
    months = days_left // 30
    days = days_left % 30
    
    return f"| Uptime: ................... {years} years, {months} months, {days} days"

def update_readme():
    uptime_string = get_uptime()
    
    try:
        with open("README.md", "r", encoding="utf-8") as f:
            content = f.read()

        # This regex looks for the markers and replaces what's inside
        pattern = r".*?"
        replacement = f"\n{uptime_string}\n"
        
        new_content = re.sub(pattern, replacement, content, flags=re.DOTALL)

        with open("README.md", "w", encoding="utf-8") as f:
            f.write(new_content)
        print("Successfully updated README uptime.")
        
    except FileNotFoundError:
        print("Error: README.md not found.")

if __name__ == "__main__":
    update_readme()
