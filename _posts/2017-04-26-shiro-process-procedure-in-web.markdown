---
layout:     post
title:      "Web环境中Shiro的处理流程"
subtitle:   
date:       2017-04-26 15:42:00
author:     "Joey"
header-img: "img/post-bg-07.jpg"
---

# 前言
主要结合Spring, Spring MVC

# Filter Proxy
结合Spring MVC一起使用时, 可以在`web.xml`中配置`Filter Proxy`:
```xml
<filter>
    <filter-name>shiroFilter</filter-name>
    <filter-class>org.springframework.web.filter.DelegatingFilterProxy</filter-class>
    <init-param>
        <param-name>targetFilterLifecycle</param-name>
        <param-value>true</param-value>
    </init-param>
</filter>
<filter-mapping>
    <filter-name>shiroFilter</filter-name>
    <url-pattern>/*</url-pattern>
    <dispatcher>REQUEST</dispatcher>
    <dispatcher>FORWARD</dispatcher>
    <dispatcher>INCLUDE</dispatcher>
    <dispatcher>ERROR</dispatcher>
</filter-mapping>
```
`DelegatingFilterProxy`默认委托Spring容器中的同名(上面代码中的`shiroFilter`)Bean进行实际`doFilter`.   

Spring中的`shiroFilter`:
```xml
<bean id="shiroFilter" class="org.apache.shiro.spring.web.ShiroFilterFactoryBean">
    <property name="filterChainDefinitions">
        <value>
            # some example chain definitions:
            # /admin/** = authc, roles[admin]
            # /docs/** = authc, perms[document:read]
            # /** = authc
            # more URL-to-FilterChain definitions here
        </value>
    </property>
</bean>
```
可以看出这是一个工厂Bean, 工厂方法会返回一个`org.apache.shiro.spring.web.ShiroFilterFactoryBean.SpringShiroFilter`对象, 值得注意的是, 第一次获取`SpringShiroFilter`对象时, 工厂Bean会解析Spring配置文件中定义的过滤器链`filterChainDefinitions`. 实际的主要过滤逻辑在`SpringShiroFilter`类的`doFilterInternal`方法中.

# 过滤逻辑
`doFilterInternal`方法实现如下:
```java
/**
 * {@code doFilterInternal} implementation that sets-up, executes, and cleans-up a Shiro-filtered request.  It
 * performs the following ordered operations:
 * <ol>
 * <li>{@link #prepareServletRequest(ServletRequest, ServletResponse, FilterChain) Prepares}
 * the incoming {@code ServletRequest} for use during Shiro's processing</li>
 * <li>{@link #prepareServletResponse(ServletRequest, ServletResponse, FilterChain) Prepares}
 * the outgoing {@code ServletResponse} for use during Shiro's processing</li>
 * <li> {@link #createSubject(javax.servlet.ServletRequest, javax.servlet.ServletResponse) Creates} a
 * {@link Subject} instance based on the specified request/response pair.</li>
 * <li>Finally {@link Subject#execute(Runnable) executes} the
 * {@link #updateSessionLastAccessTime(javax.servlet.ServletRequest, javax.servlet.ServletResponse)} and
 * {@link #executeChain(javax.servlet.ServletRequest, javax.servlet.ServletResponse, javax.servlet.FilterChain)}
 * methods</li>
 * </ol>
 * <p/>
 * The {@code Subject.}{@link Subject#execute(Runnable) execute(Runnable)} call in step #4 is used as an
 * implementation technique to guarantee proper thread binding and restoration is completed successfully.
 *
 * @param servletRequest  the incoming {@code ServletRequest}
 * @param servletResponse the outgoing {@code ServletResponse}
 * @param chain           the container-provided {@code FilterChain} to execute
 * @throws IOException                    if an IO error occurs
 * @throws javax.servlet.ServletException if an Throwable other than an IOException
 */
protected void doFilterInternal(ServletRequest servletRequest, ServletResponse servletResponse, final FilterChain chain)
        throws ServletException, IOException {
    Throwable t = null;
    try {
        final ServletRequest request = prepareServletRequest(servletRequest, servletResponse, chain);   // 1
        final ServletResponse response = prepareServletResponse(request, servletResponse, chain);       // 2
        final Subject subject = createSubject(request, response);                                       // 3
        //noinspection unchecked
        subject.execute(new Callable() {                                                                // 4
            public Object call() throws Exception {
                updateSessionLastAccessTime(request, response);
                executeChain(request, response, chain);                                                 // 5
                return null;
            }
        });
    } catch (ExecutionException ex) {
        t = ex.getCause();
    } catch (Throwable throwable) {
        t = throwable;
    }

    if (t != null) {
        if (t instanceof ServletException) {
            throw (ServletException) t;
        }
        if (t instanceof IOException) {
            throw (IOException) t;
        }
        //otherwise it's not one of the two exceptions expected by the filter method signature - wrap it in one:
        String msg = "Filtered request failed.";
        throw new ServletException(msg, t);
    }
}
```
1. 把`javax.servlet.http.HttpServletRequest`包装成`org.apache.shiro.web.servlet.ShiroHttpServletRequest`.
```java
/**
 * Wraps the original HttpServletRequest in a {@link ShiroHttpServletRequest}, which is required for supporting
 * Servlet Specification behavior backed by a {@link org.apache.shiro.subject.Subject Subject} instance.
 *
 * @param orig the original Servlet Container-provided incoming {@code HttpServletRequest} instance.
 * @return {@link ShiroHttpServletRequest ShiroHttpServletRequest} instance wrapping the original.
 * @since 1.0
 */
protected ServletRequest wrapServletRequest(HttpServletRequest orig) {
        return new ShiroHttpServletRequest(orig, getServletContext(), isHttpSessions());
}
```
2. 把`javax.servlet.http.HttpServletResponse`包装成`org.apache.shiro.web.servlet.ShiroHttpServletResponse`.
```java
/**
 * Returns a new {@link ShiroHttpServletResponse} instance, wrapping the {@code orig} argument, in order to provide
 * correct URL rewriting behavior required by the Servlet Specification when using Shiro-based sessions (and not
 * Servlet Container HTTP-based sessions).
 *
 * @param orig    the original {@code HttpServletResponse} instance provided by the Servlet Container.
 * @param request the {@code ShiroHttpServletRequest} instance wrapping the original request.
 * @return the wrapped ServletResponse instance to use during {@link FilterChain} execution.
 * @since 1.0
 */
protected ServletResponse wrapServletResponse(HttpServletResponse orig, ShiroHttpServletRequest request) {
        return new ShiroHttpServletResponse(orig, getServletContext(), request);
}
```
3. 构造`Subject`对象.
4. 主要是把`subject`绑定到线程, 使用包装后的`request`和`response`继续执行过滤器链`FilterChain`.  
5. 这一步实在`4`中执行的, `executeChain`方法实现如下:  
```java
// location: org.apache.shiro.web.servlet.AbstractShiroFilter
/**
 * Executes a {@link FilterChain} for the given request.
 * <p/>
 * This implementation first delegates to
 * <code>{@link #getExecutionChain(javax.servlet.ServletRequest, javax.servlet.ServletResponse, javax.servlet.FilterChain) getExecutionChain}</code>
 * to allow the application's Shiro configuration to determine exactly how the chain should execute.  The resulting
 * value from that call is then executed directly by calling the returned {@code FilterChain}'s
 * {@link FilterChain#doFilter doFilter} method.  That is:
 * <pre>
 * FilterChain chain = {@link #getExecutionChain}(request, response, origChain);
 * chain.{@link FilterChain#doFilter doFilter}(request,response);</pre>
 *
 * @param request   the incoming ServletRequest
 * @param response  the outgoing ServletResponse
 * @param origChain the Servlet Container-provided chain that may be wrapped further by an application-configured
 *                  chain of Filters.
 * @throws IOException      if the underlying {@code chain.doFilter} call results in an IOException
 * @throws ServletException if the underlying {@code chain.doFilter} call results in a ServletException
 * @since 1.0
 */
protected void executeChain(ServletRequest request, ServletResponse response, FilterChain origChain)
        throws IOException, ServletException {
        FilterChain chain = getExecutionChain(request, response, origChain);
        chain.doFilter(request, response);
}
```
其中`getExecutionChain`方法调用过滤器链解析器(默认`org.apache.shiro.web.filter.mgt.PathMatchingFilterChainResolver`)解析`request URI`获取对应Shiro过滤器(可以参考[Shiro Web Default Filters][shiro default filter]), 然后返回一个代理过滤器链(`org.apache.shiro.web.servlet.ProxiedFilterChain.`), 作用是保证Shiro过滤器链执行完毕后继续执行其他过滤器.  
`chain.doFilter(request, response);`即调用`ProxiedFilterChain`的`doFilter`方法.

# 自定义认证和授权逻辑
**[Shiro Web过滤器][shiro default filter]** 有很多种, 其中有两大类比较重要, **认证** 和 **授权**.这两大类过滤器在进行 **认证** 或 **授权** 时, 实际都是委托`Subject`完成, 而`Subject`则是委托`Realm`来完成的. 所以想自定义认证和授权逻辑的话, 可以实现一个 **自定义Realm** . Shiro提供了一个便利的抽象类`org.apache.shiro.realm.AuthorizingRealm`方便自定义Realm的实现.  只需要继承它并实现`doGetAuthenticationInfo`和`doGetAuthorizationInfo`方法即可.

可以配置多个`Realm`, Shiro提供多种 **多Realm** 认证(或授权)策略.


[shiro default filter]: http://shiro.apache.org/web.html#Web-defaultfilters
