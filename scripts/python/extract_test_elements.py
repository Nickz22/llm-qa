import sys
import os
from bs4 import BeautifulSoup
import json


def extract_test_elements(html_content):
    soup = BeautifulSoup(html_content, "html.parser")
    test_elements = []
    for element in soup.find_all(attrs={"data-test-id": True}):
        test_id = element.get("data-test-id")
        if test_id and test_id.startswith("e2e-"):
            # Start with base required field
            element_info = {"test_id": test_id}

            # Only add fields if they have truthy values
            tag = element.name
            if tag:
                element_info["tag"] = tag

            element_type = element.get("type")
            if element_type:
                element_info["type"] = element_type

            text = element.get_text(strip=True)
            if text:
                element_info["text"] = text

            aria_label = element.get("aria-label")
            if aria_label:
                element_info["aria_label"] = aria_label

            placeholder = element.get("placeholder")
            if placeholder:
                element_info["placeholder"] = placeholder

            # Handle label separately since it requires additional lookup
            if element.get("id"):
                label = soup.find("label", attrs={"for": element["id"]})
                if label:
                    label_text = label.get_text(strip=True)
                    if label_text:
                        element_info["label"] = label_text

            test_elements.append(element_info)
    return json.dumps(test_elements, indent=2)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python extract_test_elements.py <path_to_html_file>")
        sys.exit(1)

    file_path = sys.argv[1]

    if not os.path.exists(file_path):
        print(f"Error: File '{file_path}' does not exist.")
        sys.exit(1)

    with open(file_path, "r", encoding="utf-8") as file:
        html_content = file.read()

    print(extract_test_elements(html_content))
