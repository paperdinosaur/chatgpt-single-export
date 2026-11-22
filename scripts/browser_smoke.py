"""Isolated, synthetic Chromium extension smoke; never uses a personal profile.

Requires the optional Python playwright package and an installed Edge/Chromium.
The fixture grants host access in a TEMPORARY manifest to simulate activeTab.
The shipped manifest is never modified and requests activeTab only.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import tempfile
import zipfile

from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--browser')
args = parser.parse_args()
browser = args.browser or str(Path(os.environ.get('PROGRAMFILES(X86)', r'C:\Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe')
build = root / 'build'
build.mkdir(exist_ok=True)
raw = {'id': 'synthetic', 'title': 'Synthetic export', 'current_node': 'b', 'mapping': {
    'a': {'parent': None, 'message': {'author': {'role': 'user'}, 'content': {'parts': ['Fixture only']},
                                  'metadata': {'attachments': [{'id': 'file-test', 'name': 'sample.bin'}]}}},
    'b': {'parent': 'a', 'message': {'author': {'role': 'assistant'}, 'content': {'parts': ['Fixture answer']},
                                  'metadata': {'attachments': [{'id': 'file-missing', 'name': 'unavailable.txt'}]}}}}}
with tempfile.TemporaryDirectory(prefix='browser-fixture-', dir=build) as temp:
    temp = Path(temp)
    ext = temp / 'extension'
    shutil.copytree(root / 'extension', ext)
    manifest = json.loads((ext / 'manifest.json').read_text(encoding='utf-8-sig'))
    manifest['host_permissions'] = ['https://chatgpt.com/*']
    (ext / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            str(temp / 'profile'), executable_path=browser, headless=True,
            ignore_default_args=['--disable-extensions'],
            args=[f'--disable-extensions-except={ext}', f'--load-extension={ext}',
                  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run'])
        downloads, errors, requested = [], [], []
        def route_request(route):
            url = route.request.url
            requested.append(url.split('?')[0])
            if url == 'https://chatgpt.com/c/synthetic':
                route.fulfill(content_type='text/html', body='<title>Fixture only</title>')
            elif url.endswith('/api/auth/session'):
                route.fulfill(json={'user': {'id': 'synthetic'}, 'accessToken': 'TEST-TOKEN-ONLY'})
            elif url.endswith('/backend-api/conversation/synthetic'):
                route.fulfill(json=raw)
            elif '/backend-api/files/download/file-test?' in url:
                route.fulfill(json={'url': 'https://files.oaiusercontent.com/fixture'})
            elif '/backend-api/files/download/file-missing?' in url:
                route.fulfill(status=404, body='Unavailable fixture')
            elif url == 'https://files.oaiusercontent.com/fixture':
                route.fulfill(body=bytes([0, 128, 255]), headers={'access-control-allow-origin': '*'}, content_type='application/octet-stream')
            elif url.startswith('chrome-extension://'):
                route.continue_()
            else:
                route.abort()
        context.route('**/*', route_request)
        def watch(page):
            page.on('download', lambda d: downloads.append(d))
            page.on('pageerror', lambda e: errors.append(str(e)))
        context.on('page', watch)
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        page = context.new_page()
        page.goto('https://chatgpt.com/c/synthetic')
        tab_id = worker.evaluate("async()=> (await chrome.tabs.query({url:'https://chatgpt.com/*'}))[0].id")
        extension_id = worker.url.split('/')[2]
        with context.expect_page() as opened:
            worker.evaluate("async ({id,tab})=>chrome.tabs.create({url:`chrome-extension://${id}/export.html?tab=${tab}&conversation=synthetic`})", {'id': extension_id, 'tab': tab_id})
        export = opened.value
        export.locator('#download').wait_for(state='visible', timeout=45000)
        export.wait_for_timeout(800)
        assert not errors, errors
        assert downloads, 'No ZIP download was emitted'
        target = build / 'browser-synthetic.zip'
        downloads[-1].save_as(target)
        with zipfile.ZipFile(target) as z:
            assert z.testzip() is None
            doc = json.loads(z.read('conversation.json'))
            receipt = json.loads(z.read('manifest.json'))
            assert len(doc['messages']) == 2
            assert receipt['complete'] is False
            assert [f['status'] for f in receipt['files']] == ['available', 'missing']
            assert z.read(doc['files'][0]['local_path']) == bytes([0, 128, 255])
            assert b'TEST-TOKEN' not in z.read('conversation.json')
        assert not any('/conversations?' in u or '/gizmos/' in u for u in requested)
        report = {'passed': True, 'environment': 'isolated Edge, synthetic network fixtures',
                  'temporary_host_grant': True, 'real_account_tested': False,
                  'messages': 2, 'available_attachments': 1, 'missing_attachments': 1,
                  'download_emitted': True, 'zip_crc_verified': True, 'page_errors': 0}
        (build / 'browser-smoke.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report))
        context.close()
