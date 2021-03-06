import requests
import base64
import json
import os
from urlparse import urljoin
from os import environ as env

def b64_decode(data):
    missing_padding = (4 - len(data) % 4) % 4
    if missing_padding:
        data += b'='* missing_padding
    return base64.decodestring(data)

if 'APIGEE_TOKEN1' in env:
    TOKEN1 = env['APIGEE_TOKEN1']
else:
    with open('token.txt') as f:
        TOKEN1 = f.read()
USER1_CLAIMS = json.loads(b64_decode(TOKEN1.split('.')[1]))      
USER1 = '%s#%s' % (USER1_CLAIMS['iss'], USER1_CLAIMS['sub'])
USER1_E = USER1.replace('#', '%23')

COMPONENT_NAME = os.environ.get('COMPONENT_NAME')
SCHEME = os.environ.get('SCHEME')
AUTHORITY = os.environ.get('AUTHORITY')
BASE_RESOURCE = os.environ.get('BASE_RESOURCE')
RESOURCES_PROPERTY = os.environ.get('RESOURCES_PROPERTY') or COMPONENT_NAME
BASE_URL = '%s://%s' % (SCHEME, AUTHORITY)

def main():
    
    # Create example

    description = 'example resource'
    example = {
        'isA': 'Example',
        'description': description     
    }
    examples_url = '%s://%s%s%s' % (SCHEME, AUTHORITY, BASE_RESOURCE, RESOURCES_PROPERTY)
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'BEARER %s' % TOKEN1}
    r = requests.post(examples_url, headers=headers, json=example)
    if r.status_code == 201:
        example_url = urljoin(BASE_URL, r.headers['Location'])
        example_etag = r.headers['Etag'] 
        print 'correctly created example Etag: %s Location: %s' % (r.headers['etag'], r.headers['Location'])
    else:
        print 'failed to create example %s %s' % (r.status_code, r.text)
        return
    
    # Retrieve example for Acme org

    headers['Accept'] = 'application/json'
    r = requests.get(example_url, headers=headers)
    if r.status_code == 200:
        example = r.json()
        if example['description'] == description:
            print 'correctly retrieved resource. Etag: %s Content-Location: %s' % (r.headers['etag'], r.headers['Content-Location'])
        else:
            print 'retrieved example but comparison failed %s' % example
    else:
        print 'failed to retrieve example %s %s' % (r.status_code, r.text)
    
    # Update example

    updated_description = 'better description'
    patch = {
        'description': updated_description,
    }

    headers = {'Content-Type': 'application/merge-patch+json', 'Accept': 'application/json','Authorization': 'BEARER %s' % TOKEN1, 'If-Match': example_etag}
    r = requests.patch(example_url, headers=headers, json=patch)
    if r.status_code == 200:
        print 'correctly patched example' 
    else:
        print 'failed to patch example %s %s' % (r.status_code, r.text)
    
    # Delete example

    headers = {'Accept': 'application/json', 'Authorization': 'BEARER %s' % TOKEN1}
    r = requests.delete(example_url, headers=headers)
    if r.status_code == 200:
        print 'correctly deleted %s' % example_url
    else:
        print 'failed to delete %s status_code: %s text: %s' % (example_url, r.status_code, r.text)

if __name__ == '__main__':
    main()