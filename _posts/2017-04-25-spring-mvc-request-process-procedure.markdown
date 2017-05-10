---
layout:     post
title:      "Spring MVC 请求处理流程"
subtitle:   
date:       2017-04-25 13:08:00
author:     "Joey"
header-img: "img/post-bg-06.jpg"
---

1. 请求经过应用服务器(e.g. Tomcat)进入`org.springframework.web.servlet.DispatcherServlet`.

2. `DispatcherServlet`会先给`request`设置几个属性,方便业务处理中使用.
```java
// Make framework objects available to handlers and view objects.
request.setAttribute(WEB_APPLICATION_CONTEXT_ATTRIBUTE, getWebApplicationContext());
request.setAttribute(LOCALE_RESOLVER_ATTRIBUTE, this.localeResolver);
request.setAttribute(THEME_RESOLVER_ATTRIBUTE, this.themeResolver);
request.setAttribute(THEME_SOURCE_ATTRIBUTE, getThemeSource());
```

3. 获取`request`中的`FlashMap`,如果不等于空的话,放入`request`中,同时将输出用FlashMap和FlashMap管理器放入`request`中.
```java
FlashMap inputFlashMap = this.flashMapManager.retrieveAndUpdate(request, response);
if (inputFlashMap != null) {
    request.setAttribute(INPUT_FLASH_MAP_ATTRIBUTE, Collections.unmodifiableMap(inputFlashMap));
}
request.setAttribute(OUTPUT_FLASH_MAP_ATTRIBUTE, new FlashMap());
request.setAttribute(FLASH_MAP_MANAGER_ATTRIBUTE, this.flashMapManager);
```

4. 调用`doDispatch(request, response)`方法进行实际的分发处理.
```java
doDispatch(request, response);
```

5. `doDispatch(request, response)`方法中流程如下:  
首先通过`request`获取用于处理该请求的处理器链.  
```java
// Determine handler for the current request.
mappedHandler = getHandler(processedRequest);  
```
```java
// location: org.springframework.web.servlet.DispatcherServlet
/**
 * Return the HandlerExecutionChain for this request.
 * <p>Tries all handler mappings in order.
 * @param request current HTTP request
 * @return the HandlerExecutionChain, or {@code null} if no handler could be found
 */
protected HandlerExecutionChain getHandler(HttpServletRequest request) throws Exception {
        for (HandlerMapping hm : this.handlerMappings) {
            if (logger.isTraceEnabled()) {
                logger.trace(
                        "Testing handler map [" + hm + "] in DispatcherServlet with name '" + getServletName() + "'");
            }
            HandlerExecutionChain handler = hm.getHandler(request);
            if (handler != null) {
                return handler;
            }
        }
        return null;
}
```
如果配置文件中配置了`<mvc:annotation-driven/>`的话,上面的代码中的`HandlerMapping`即是`RequestMappingHandlerMapping`. `hm.getHandler(request)`最终会调用下面这个方法构造`HandlerExecutionChain`. `HandlerExecutionChain`中主要包含处理器方法(`HandlerMethod`)和所有适用的拦截器.  
```java
/**
 * Build a {@link HandlerExecutionChain} for the given handler, including
 * applicable interceptors.
 * <p>The default implementation builds a standard {@link HandlerExecutionChain}
 * with the given handler, the handler mapping's common interceptors, and any
 * {@link MappedInterceptor}s matching to the current request URL. Interceptors
 * are added in the order they were registered. Subclasses may override this
 * in order to extend/rearrange the list of interceptors.
 * <p><b>NOTE:</b> The passed-in handler object may be a raw handler or a
 * pre-built {@link HandlerExecutionChain}. This method should handle those
 * two cases explicitly, either building a new {@link HandlerExecutionChain}
 * or extending the existing chain.
 * <p>For simply adding an interceptor in a custom subclass, consider calling
 * {@code super.getHandlerExecutionChain(handler, request)} and invoking
 * {@link HandlerExecutionChain#addInterceptor} on the returned chain object.
 * @param handler the resolved handler instance (never {@code null})
 * @param request current HTTP request
 * @return the HandlerExecutionChain (never {@code null})
 * @see #getAdaptedInterceptors()
 */
protected HandlerExecutionChain getHandlerExecutionChain(Object handler, HttpServletRequest request) {
    HandlerExecutionChain chain = (handler instanceof HandlerExecutionChain ?
            (HandlerExecutionChain) handler : new HandlerExecutionChain(handler));

        String lookupPath = this.urlPathHelper.getLookupPathForRequest(request);
        for (HandlerInterceptor interceptor : this.adaptedInterceptors) {
            if (interceptor instanceof MappedInterceptor) {
                MappedInterceptor mappedInterceptor = (MappedInterceptor) interceptor;
                if (mappedInterceptor.matches(lookupPath, this.pathMatcher)) {
                    chain.addInterceptor(mappedInterceptor.getInterceptor());
                }
            }
            else {
                chain.addInterceptor(interceptor);
            }
        }
        return chain;
}
```

6. 获取处理器适配器  
```java
// Determine handler adapter for the current request.
HandlerAdapter ha = getHandlerAdapter(mappedHandler.getHandler());  
```
```java
/**
 * Return the HandlerAdapter for this handler object.
 * @param handler the handler object to find an adapter for
 * @throws ServletException if no HandlerAdapter can be found for the handler. This is a fatal error.
 */
protected HandlerAdapter getHandlerAdapter(Object handler) throws ServletException {
        for (HandlerAdapter ha : this.handlerAdapters) {
            if (logger.isTraceEnabled()) {
                logger.trace("Testing handler adapter [" + ha + "]");
            }
            if (ha.supports(handler)) {
                return ha;
            }
        }
        throw new ServletException("No adapter for handler [" + handler +
                "]: The DispatcherServlet configuration needs to include a HandlerAdapter that supports this handler");
}
```
如果配置文件中配置了`<mvc:annotation-driven/>`的话,上面的代码中的`HandlerAdapter`即是`RequestMappingHandlerAdapter`.  

7. 调用处理器链的`applyPreHandle`方法, 这个方法会遍历处理器链中所有拦截器并分别调用`preHandle`方法.  
```java
if (!mappedHandler.applyPreHandle(processedRequest, response)) {
	   return;
}  
```

8. 调用处理器适配器的`handle`方法, 这个方法才是实际的处理方法调用.  
```java
// Actually invoke the handler.
mv = ha.handle(processedRequest, response, mappedHandler.getHandler());  
```
接着会调用`RequestMappingHandlerAdapter`的`invokeHandlerMethod`方法, 这个方法会为实际处理方法的调用做一些准备工作, 比如设置`argumentResolvers`,`returnValueHandlers`,`parameterNameDiscoverer`等参数, 并实例化一个`ModelAndView`容器.  
```java
// location: org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerAdapter
/**
 * Invoke the {@link RequestMapping} handler method preparing a {@link ModelAndView}
 * if view resolution is required.
 * @since 4.2
 * @see #createInvocableHandlerMethod(HandlerMethod)
 */
protected ModelAndView invokeHandlerMethod(HttpServletRequest request,
        HttpServletResponse response, HandlerMethod handlerMethod) throws Exception {

        ServletWebRequest webRequest = new ServletWebRequest(request, response);
        try {
            WebDataBinderFactory binderFactory = getDataBinderFactory(handlerMethod);
            ModelFactory modelFactory = getModelFactory(handlerMethod, binderFactory);

            ServletInvocableHandlerMethod invocableMethod = createInvocableHandlerMethod(handlerMethod);
            invocableMethod.setHandlerMethodArgumentResolvers(this.argumentResolvers);
            invocableMethod.setHandlerMethodReturnValueHandlers(this.returnValueHandlers);
            invocableMethod.setDataBinderFactory(binderFactory);
            invocableMethod.setParameterNameDiscoverer(this.parameterNameDiscoverer);

            ModelAndViewContainer mavContainer = new ModelAndViewContainer();
            mavContainer.addAllAttributes(RequestContextUtils.getInputFlashMap(request));
            modelFactory.initModel(webRequest, mavContainer, invocableMethod);
            mavContainer.setIgnoreDefaultModelOnRedirect(this.ignoreDefaultModelOnRedirect);

            AsyncWebRequest asyncWebRequest = WebAsyncUtils.createAsyncWebRequest(request, response);
            asyncWebRequest.setTimeout(this.asyncRequestTimeout);

            WebAsyncManager asyncManager = WebAsyncUtils.getAsyncManager(request);
            asyncManager.setTaskExecutor(this.taskExecutor);
            asyncManager.setAsyncWebRequest(asyncWebRequest);
            asyncManager.registerCallableInterceptors(this.callableInterceptors);
            asyncManager.registerDeferredResultInterceptors(this.deferredResultInterceptors);

            if (asyncManager.hasConcurrentResult()) {
                Object result = asyncManager.getConcurrentResult();
                mavContainer = (ModelAndViewContainer) asyncManager.getConcurrentResultContext()[0];
                asyncManager.clearConcurrentResult();
                if (logger.isDebugEnabled()) {
                    logger.debug("Found concurrent result value [" + result + "]");
                }
                invocableMethod = invocableMethod.wrapConcurrentResult(result);
            }

            invocableMethod.invokeAndHandle(webRequest, mavContainer);
            if (asyncManager.isConcurrentHandlingStarted()) {
                return null;
            }

            return getModelAndView(mavContainer, modelFactory, webRequest);
        }
        finally {
            webRequest.requestCompleted();
        }
}
```
上面代码中的`invocableMethod.invokeAndHandle(webRequest, mavContainer);`即实际处理方法的调用. 而`getModelAndView(mavContainer, modelFactory, webRequest);`则是从`ModelAndView`容器取出`ModelAndView`, 具体实现如下:  
```java
/**
 * Invokes the method and handles the return value through one of the
 * configured {@link HandlerMethodReturnValueHandler}s.
 * @param webRequest the current request
 * @param mavContainer the ModelAndViewContainer for this request
 * @param providedArgs "given" arguments matched by type (not resolved)
 */
public void invokeAndHandle(ServletWebRequest webRequest,
        ModelAndViewContainer mavContainer, Object... providedArgs) throws Exception {

        Object returnValue = invokeForRequest(webRequest, mavContainer, providedArgs);
        setResponseStatus(webRequest);

        if (returnValue == null) {
            if (isRequestNotModified(webRequest) || hasResponseStatus() || mavContainer.isRequestHandled()) {
                mavContainer.setRequestHandled(true);
                return;
            }
        }
        else if (StringUtils.hasText(this.responseReason)) {
            mavContainer.setRequestHandled(true);
            return;
        }

        mavContainer.setRequestHandled(false);
        try {
            this.returnValueHandlers.handleReturnValue(returnValue, getReturnValueType(returnValue), mavContainer, webRequest);
        }
        catch (Exception ex) {
            if (logger.isTraceEnabled()) {
                logger.trace(getReturnValueHandlingErrorMessage("Error handling return value", returnValue), ex);
            }
            throw ex;
        }
}
```
方法一开始就会调用实际处理方法并获取返回值`Object returnValue = invokeForRequest(webRequest, mavContainer, providedArgs);`, 根据返回值判断这个请求是否被完全处理了(完全处理的意思就是不需要再进行视图渲染等). `mavContainer.setRequestHandled(true);`就是用来标记是否被完全处理.  
需要注意的是  
```java
this.returnValueHandlers.handleReturnValue(returnValue, getReturnValueType(returnValue), mavContainer, webRequest);  
```
这段代码会处理返回值, 比如带有`@ResponseBody`注解的方法会用`org.springframework.web.servlet.mvc.method.annotation.RequestResponseBodyMethodProcessor`处理. 这个阶段会涉及Message Convert.  
下面是`org.springframework.web.servlet.mvc.method.annotation.RequestResponseBodyMethodProcessor`返回值处理实现:  
```java
// location: org.springframework.web.servlet.mvc.method.annotation.RequestResponseBodyMethodProcessor
public void handleReturnValue(Object returnValue, MethodParameter returnType,
        ModelAndViewContainer mavContainer, NativeWebRequest webRequest)
        throws IOException, HttpMediaTypeNotAcceptableException, HttpMessageNotWritableException {

        mavContainer.setRequestHandled(true);
        ServletServerHttpRequest inputMessage = createInputMessage(webRequest);
        ServletServerHttpResponse outputMessage = createOutputMessage(webRequest);

        // Try even with null return value. ResponseBodyAdvice could get involved.
        writeWithMessageConverters(returnValue, returnType, inputMessage, outputMessage);
}  
```
`writeWithMessageConverters(returnValue, returnType, inputMessage, outputMessage);`会进行Message Convert.  
```java
private ModelAndView getModelAndView(ModelAndViewContainer mavContainer,
        ModelFactory modelFactory, NativeWebRequest webRequest) throws Exception {

        modelFactory.updateModel(webRequest, mavContainer);
        if (mavContainer.isRequestHandled()) {
            return null;
        }
        ModelMap model = mavContainer.getModel();
        ModelAndView mav = new ModelAndView(mavContainer.getViewName(), model, mavContainer.getStatus());
        if (!mavContainer.isViewReference()) {
            mav.setView((View) mavContainer.getView());
        }
        if (model instanceof RedirectAttributes) {
            Map<String, ?> flashAttributes = ((RedirectAttributes) model).getFlashAttributes();
            HttpServletRequest request = webRequest.getNativeRequest(HttpServletRequest.class);
            RequestContextUtils.getOutputFlashMap(request).putAll(flashAttributes);
        }
        return mav;
}
```
可以看到, 在从`ModelAndView`容器取出`ModelAndView`时, 会先调用`mavContainer.isRequestHandled`判断请求是否已被完全处理(上面说过).  如果已经被完全处理了, 直接返回null(返回null就不会进行视图渲染 详情见[11](#11)).  

9. 调用`applyDefaultViewName(processedRequest, mv);`设置默认视图名, 实现如下:  
```java
/**
 * Do we need view name translation?
 */
private void applyDefaultViewName(HttpServletRequest request, ModelAndView mv) throws Exception {
        if (mv != null && !mv.hasView()) {
            mv.setViewName(getDefaultViewName(request));
        }
}
```
```java
/**
 * Translate the supplied request into a default view name.
 * @param request current HTTP servlet request
 * @return the view name (or {@code null} if no default found)
 * @throws Exception if view name translation failed
 */
protected String getDefaultViewName(HttpServletRequest request) throws Exception {
        return this.viewNameTranslator.getViewName(request);
}
```
默认`viewNameTranslator`是`org.springframework.web.servlet.view.DefaultRequestToViewNameTranslator`, 默认生成视图名策略是去掉请求URI的前后`/`和扩展名.  
例:  _/myblog/blog.txt -> myblog/blog_

10. 调用处理器链的`applyPostHandle`方法, 这个方法会遍历处理器链中所有拦截器并分别调用`postHandle`方法.
```java
mappedHandler.applyPostHandle(processedRequest, response, mv);
```

11. <a name="11"></a>调用`processDispatchResult(processedRequest, response, mappedHandler, mv, dispatchException);`进行结果处理, 主要任务是视图渲染.
```java
/**
 * Handle the result of handler selection and handler invocation, which is
 * either a ModelAndView or an Exception to be resolved to a ModelAndView.
 */
private void processDispatchResult(HttpServletRequest request, HttpServletResponse response,
        HandlerExecutionChain mappedHandler, ModelAndView mv, Exception exception) throws Exception {

        boolean errorView = false;

        if (exception != null) {
            if (exception instanceof ModelAndViewDefiningException) {
                logger.debug("ModelAndViewDefiningException encountered", exception);
                mv = ((ModelAndViewDefiningException) exception).getModelAndView();
            }
            else {
                Object handler = (mappedHandler != null ? mappedHandler.getHandler() : null);
                mv = processHandlerException(request, response, handler, exception);
                errorView = (mv != null);
            }
        }

        // Did the handler return a view to render?
        if (mv != null && !mv.wasCleared()) {
            render(mv, request, response);
            if (errorView) {
                WebUtils.clearErrorRequestAttributes(request);
            }
        }
        else {
            if (logger.isDebugEnabled()) {
                logger.debug("Null ModelAndView returned to DispatcherServlet with name '" + getServletName() +
                        "': assuming HandlerAdapter completed request handling");
            }
        }

        if (WebAsyncUtils.getAsyncManager(request).isConcurrentHandlingStarted()) {
            // Concurrent handling started during a forward
            return;
        }

        if (mappedHandler != null) {
            mappedHandler.triggerAfterCompletion(request, response, null);
        }
}
```
需要注意的是是否渲染的判断条件, `mv != null && !mv.wasCleared()`. 也就是说着两种情况下是不会进行视图渲染的.  
最后会调用处理器链的`triggerAfterCompletion`方法, 触发所有拦截器的`afterCompletion`  
```java
if (mappedHandler != null) {
        mappedHandler.triggerAfterCompletion(request, response, null);
}
```
这个方法在发生异常时也会调用.

<br/>
<br/>
<br/>
### SUMMARY
> Spring太屌
