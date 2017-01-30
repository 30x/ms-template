'use strict'
const http = require('http')
const url = require('url')
const lib = require('http-helper-functions')
const db = require('./pg-storage.js')
const pLib = require('permissions-helper-functions')

const COMPONENT = process.env.COMPONENT
const BASE_RESOURCE = process.env.BASE_RESOURCE || '/'
const RESOURCES_PROPERTY = process.env.RESOURCES_PROPERTY || COMPONENT
const CHECK_PERMISSIONS = process.env.CHECK_PERMISSIONS
const RESOURCES_PATH = `${BASE_RESOURCE}${RESOURCES_PROPERTY}`
const RESOURCES_PREFIX = `${BASE_RESOURCE}${RESOURCES_PROPERTY}/`

console.log(RESOURCES_PATH, RESOURCES_PREFIX, CHECK_PERMISSIONS)

function handleErr(req, res, err, param, callback) {
  if (err == 404) 
    lib.notFound(req, res)
  else if (err == 400)
    lib.badRequest(res, param)
  else if (err == 409)
    lib.respond(req, res, 409, {}, {statusCode:409, msg: param})
  else if (err == 500)
    lib.internalError(res, param)
  else if (err)
    lib.internalError(res, err)
  else 
    callback()
}

function log(funcionName, text) {
  console.log(Date.now(), COMPONENT, funcionName, text)
}

function ifAllowedThen (req, res, url, property, action, base, path, callback) {
  if (CHECK_PERMISSIONS)
    plib.ifAllowedThen (req, res, url, property, action, base, path, callback)
  else
    callback()
}

function createPermissionsThen (req, res, url, permissions, callback) {
  if (CHECK_PERMISSIONS)
    plib.createPermissionsThen (req, res, url, permissions, callback)
  else
    callback()
}

function deletePermissionsThen(req, res, resourceURL) {
  if (CHECK_PERMISSIONS)
    lib.sendInternalRequest(req.headers, `/permissions?${resourceURL}`, 'DELETE', undefined, function (err, clientRes) {
      if (err)
        handleErr(req, res, err, clientRes)
      else
        lib.getClientResponseBody(clientRes, function(body) {
          var statusCode = clientRes.statusCode
          if (statusCode !== 200)
            log('deleteResource', `unable to delete permissions for ${resourceURL}`)
        })
    })  
}

function verifyResource(resource, callback) {
  callback(null)
}

function createResource(req, res, resource) {
  ifAllowedThen(req, res, `${RESOURCES_PREFIX}${RESOURCES_PROPERTY}`, '_self', 'create', null, null, function() {
    verifyResource(resource, function(err) { 
      if (err !== null) 
        lib.badRequest(res, err)
      else {
        var id = lib.uuid4()
        var selfURL = makeSelfURL(req, id)
        var permissions = resource._permissions
        if (permissions !== undefined) {
          delete resource._permissions; // unusual case where ; is necessary
          (new pLib.Permissions(permissions)).resolveRelativeURLs(selfURL)
        }
        createPermissionsThen(req, res, selfURL, permissions, function(err, permissionsURL, permissions, responseHeaders){
          // Create permissions first. If we fail after creating the permissions resource but before creating the main resource, 
          // there will be a useless but harmless permissions document.
          // If we do things the other way around, a resource without matching permissions could cause problems.
          db.createResourceThen(id, resource, function(err, etag) {
            if (err)
              handleError(req, res, err, etag)
            else {
              resource.self = selfURL 
              addCalculatedProperties(resource)
              lib.created(req, res, resource, resource.self, etag)
            }
          })
        })
      }
    })
  })
}

function makeSelfURL(req, key) {
  return `scheme://authority${RESOURCES_PREFIX}${key}`
}

function addCalculatedProperties(resource) {
  var externalSelf = lib.externalizeURLs(resource.self)
  resource._permissions = `scheme://authority/permissions?${externalSelf}`
  resource._permissionsHeirs = `scheme://authority/permissions-heirs?${externalSelf}`  
}

function getResource(req, res, id) {
  ifAllowedThen(req, res, null, '_self', 'read', null, null, function(err, reason) {
    db.withResourceDo(id, function(err, resource , etag) {
      if (err)
        handleErr(req, res, err, resource)
      else {
        resource.self = makeSelfURL(req, id)
        addCalculatedProperties(resource)
        lib.externalizeURLs(resource, req.headers.host)
        lib.found(req, res, resource, etag)
      }
    })
  })
}

function deleteResource(req, res, id) {
  var resourceURL = '//' + req.headers.host + req.url
  ifAllowedThen(req, res, url, '_self', 'delete', null, null, function(err, reason) {
    db.deleteResourceThen(id, function (err, resource, etag) {
      if (err)
        handleErr(req, res, err, resource)
      else
        deletePermissionsThen(req, res, resourceURL) // Don't wait for this. If it fails, there will be a dangling resource object
      addCalculatedProperties(resource)
      lib.found(req, res, resource, etag)
    })
  })
}

function updateResource(req, res, id, patch) {
  ifAllowedThen(req, res, null, '_self', 'update', null, null, function() {
    db.withResourceDo(id, function(err, resource , etag) {
      if (err)
        handleErr(req, res, err, etag)
      else if (req.headers['if-match'] == etag) { 
        lib.applyPatch(req, res, resource, patch, function(patchedResource) {
          verifyResource(patchedResource, function(err) {
            if (err)
              lib.badRequest(res, err)
            else
              db.updateResourceThen(id, patchedResource, etag, function (err, etag) {
                log('updateResource', `updated resource. err: ${err} id: ${id} etag: ${etag}`)
                if (err)
                  handleErr(req, res, err, etag)
                else {
                  patchedResource.self = makeSelfURL(req, id) 
                  addCalculatedProperties(patchedResource)
                  lib.found(req, res, patchedResource, etag)
                }
              })
          })
        })
      } else {
        var err = (req.headers['if-match'] === undefined) ? 'missing If-Match header' : 'If-Match header does not match etag ' + req.headers['If-Match'] + ' ' + etag
        lib.badRequest(res, err)
      }      
    })
  })
}

function putResource(req, res, id, resource) {
  ifAllowedThen(req, res, null, '_self', 'put', null, null, function() {
    verifyResource(resource, function(err) {
      if (err)
        lib.badRequest(res, err)
      else
        db.updateResourceThen(id, makeSelfURL(req, id), resource, null, function (err, etag) {
          log('putResource', `updated resource. err: ${err} id: ${id} etag: ${etag}`)
          if (err)
            handleErr(req, res, err, errParam)
          else {
            resource.self = makeSelfURL(req, id) 
            addCalculatedProperties(resource)
            lib.found(req, res, resource, etag)
          }
        })
    })
  })
}

function requestHandler(req, res) {
  if (req.url == RESOURCES_PATH) // e.g. /examples
    if (req.method == 'POST') 
      lib.getServerPostObject(req, res, (rep) => createResource(req, res, rep))
    else 
      lib.methodNotAllowed(req, res, ['POST'])
  else {
    var req_url = url.parse(req.url)
    if (req_url.pathname.startsWith(RESOURCES_PREFIX)) {
      var id = req_url.pathname.substring(RESOURCES_PREFIX.length)
      if (req.method == 'GET')
        getResource(req, res, id)
      else if (req.method == 'DELETE') 
        deleteResource(req, res, id)
      else if (req.method == 'PATCH') 
        lib.getServerPostObject(req, res, (jso) => updateResource(req, res, id, jso))
      else if (req.method == 'PUT') 
        lib.getServerPostObject(req, res, (jso) => putResource(req, res, id, jso))
      else
        lib.methodNotAllowed(req, res, ['GET', 'DELETE', 'PATCH', 'PUT'])
    } else
      lib.notFound(req, res)
  }
}

function start(){
  db.init(function(){
    var port = process.env.PORT
    http.createServer(requestHandler).listen(port, function() {
      console.log(`server is listening on ${port}`)
    })
  })
}

start()
