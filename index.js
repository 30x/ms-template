'use strict'
const http = require('http')
const url = require('url')
const lib = require('http-helper-functions')
const rLib = require('response-helper-functions')
const db = require('./pg-storage.js')
const pLib = require('permissions-helper-functions')

const COMPONENT_NAME = process.env.COMPONENT_NAME
const BASE_RESOURCE = process.env.BASE_RESOURCE || '/'
const RESOURCES_PROPERTY = process.env.RESOURCES_PROPERTY || COMPONENT_NAME
const CHECK_PERMISSIONS = process.env.CHECK_PERMISSIONS
const RESOURCES_PATH = `${BASE_RESOURCE}${RESOURCES_PROPERTY}`
const RESOURCES_PREFIX = `${BASE_RESOURCE}${RESOURCES_PROPERTY}/`

function log(funcionName, text) {
  console.log(Date.now(), COMPONENT_NAME, funcionName, text)
}

function ifAllowedThen (req, res, url, property, action, base, path, callback) {
  if (CHECK_PERMISSIONS)
    plib.ifAllowedThen (lib.flowThroughHeaders(req), res, url, property, action, base, path, callback)
  else
    callback()
}

function createPermissionsThen (req, res, url, permissions, callback) {
  if (CHECK_PERMISSIONS)
    plib.createPermissionsThen (lib.flowThroughHeaders(req), res, url, permissions, callback)
  else
    callback()
}

function deletePermissionsThen(req, res, resourceURL, callback) {
  if (CHECK_PERMISSIONS)
    pLib.deletePermissionsThen(lib.flowThroughHeaders(req), res, resourceURL, callback)  
  else
    callback()
}

function verifyResource(res, resource, callback) {
  callback()
}

function createResource(req, res, resource) {
  ifAllowedThen(req, res, `${RESOURCES_PREFIX}${RESOURCES_PROPERTY}`, '_self', 'create', null, null, function() {
    verifyResource(res, resource, function() { 
      var id = rLib.uuid4()
      var selfURL = makeSelfURL(req, id)
      var permissions = resource._permissions
      if (permissions !== undefined) {
        delete resource._permissions; // unusual case where ; is necessary
        (new pLib.Permissions(permissions)).resolveRelativeURLs(selfURL)
      }
      createPermissionsThen(req, res, selfURL, permissions, function(permissionsURL, permissions, responseHeaders){
        // Create permissions first. If we fail after creating the permissions resource but before creating the main resource, 
        // there will be a useless but harmless permissions document.
        // If we do things the other way around, a resource without matching permissions could cause problems.
        db.createResourceThen(res, id, resource, function(etag) {
          log('createResource', `created resource. id: ${id} etag: ${etag}`)
          resource.self = selfURL 
          addCalculatedProperties(resource)
          rLib.created(res, resource, req.headers.accept, resource.self, etag)
        })
      })
    })
  })
}

function makeSelfURL(req, key) {
  return `${rLib.INTERNAL_URL_PREFIX}${RESOURCES_PREFIX}${key}`
}

function addCalculatedProperties(resource) {
  resource._permissions = `${rLib.INTERNAL_URL_PREFIX}/permissions?${resource.self}`
  resource._permissionsHeirs = `${rLib.INTERNAL_URL_PREFIX}/permissions-heirs?${resource.self}`  
}

function getResource(req, res, id) {
  ifAllowedThen(req, res, null, '_self', 'read', null, null, function(reason) {
    db.withResourceDo(res, id, function(resource , etag) {
      resource.self = makeSelfURL(req, id)
      addCalculatedProperties(resource)
      rLib.found(res, resource, req.headers.accept, resource.self, etag)
    })
  })
}

function deleteResource(req, res, id) {
  var resourceURL = makeSelfURL(req, id)
  ifAllowedThen(req, res, url, '_self', 'delete', null, null, function(reason) {
    db.deleteResourceThen(res, id, function (resource, etag) {
      log('deleteResource', `deleted resource. id: ${id} etag: ${etag}`)
      deletePermissionsThen(req, res, resourceURL, function() {}) // Don't wait for this. If it fails, there will be a dangling resource object
      addCalculatedProperties(resource)
      rLib.found(res, resource, req.headers.accept, resourceURL, etag)
    })
  })
}

function patchResource(req, res, id, patch) {
  ifAllowedThen(req, res, null, '_self', 'update', null, null, function() {
    db.withResourceDo(res, id, function(resource , etag) {
      if (req.headers['if-match'] == etag) { 
        lib.applyPatch(req, res, resource, patch, function(patchedResource) {
          verifyResource(res, patchedResource, function() {
            db.updateResourceThen(res, id, patchedResource, etag, function (etag) {
              log('patchResource', `updated resource. id: ${id} etag: ${etag}`)
              patchedResource.self = makeSelfURL(req, id) 
              addCalculatedProperties(patchedResource)
              rLib.found(res, patchedResource, req.headers.accept, patchedResource.self, etag)
            })
          })
        })
      } else {
        var err = (req.headers['if-match'] === undefined) ? 'missing If-Match header' : 'If-Match header does not match etag ' + req.headers['If-Match'] + ' ' + etag
        rLib.badRequest(res, err)
      }      
    })
  })
}

function putResource(req, res, id, resource) {
  ifAllowedThen(req, res, null, '_self', 'put', null, null, function() {
    verifyResource(res, resource, function() {
      db.updateResourceThen(res, id, makeSelfURL(req, id), resource, null, function (etag) {
        log('putResource', `updated resource. err: ${err} id: ${id} etag: ${etag}`)
        resource.self = makeSelfURL(req, id) 
        addCalculatedProperties(resource)
        rLib.found(res, resource, req.headers.accept, resource.self, etag)
      })
    })
  })
}

function requestHandler(req, res) {
  if (req.url == RESOURCES_PATH) // e.g. /examples
    if (req.method == 'POST') 
      lib.getServerPostObject(req, res, (rep) => createResource(req, res, rep))
    else 
      rLib.methodNotAllowed(req, res, ['POST'])
  else {
    var req_url = url.parse(req.url)
    if (req_url.pathname.startsWith(RESOURCES_PREFIX)) {
      var id = req_url.pathname.substring(RESOURCES_PREFIX.length)
      if (req.method == 'GET')
        getResource(req, res, id)
      else if (req.method == 'DELETE') 
        deleteResource(req, res, id)
      else if (req.method == 'PATCH') 
        lib.getServerPostObject(req, res, (jso) => patchResource(req, res, id, jso))
      else if (req.method == 'PUT') 
        lib.getServerPostObject(req, res, (jso) => putResource(req, res, id, jso))
      else
        rLib.methodNotAllowed(req, res, ['GET', 'DELETE', 'PATCH', 'PUT'])
    } else
      rLib.notFound(res, `//${req.headers.host}${req.url} not found`)
  }
}


function init (callback) {
  db.init(callback)
}

function start(){
  init(function(){
    var port = process.env.PORT
    http.createServer(requestHandler).listen(port, function() {
      console.log(`server is listening on ${port}`)
    })
  })
}

if (require.main === module) 
  start()
else 
  exports = {
    requestHandler:requestHandler,
    RESOURCES_PREFIX: RESOURCES_PREFIX,
    init: init
  }
